import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { databaseManager } from '../db/database.js';
import { appSettingsRepository } from '../db/repositories.js';

const key = 'app.family-members.v1';
const memberSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.number().int().positive(),
  revokedAt: z.number().int().positive().nullable(),
  lastJoinedAt: z.number().int().positive().nullable(),
  invite: z.object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.string().min(1).max(128),
    expiresAt: z.number().int().positive()
  }).strict().nullable()
}).strict();
const membersSchema = z.array(memberSchema).max(100);
// Separate from administrator invitations so a device link never replaces one.
const deviceInvitesKey = 'app.family-device-invites.v1';
const deviceInviteSchema = z.object({
  memberId: z.string().uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  generation: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
  issuerSessionKey: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
const deviceInvitesSchema = z.array(deviceInviteSchema).max(100);
export const familyDeviceInviteLifetimeMs = 10 * 60 * 1000;

export function isFamilySessionEnded(sessionKey: string): boolean {
  return Boolean(databaseManager.connection.prepare(
    'SELECT 1 FROM family_push_ended_sessions WHERE session_key = ?'
  ).get(sessionKey));
}

function readDeviceInvites() {
  const raw = appSettingsRepository.get(deviceInvitesKey);
  return raw == null ? [] : deviceInvitesSchema.parse(JSON.parse(raw));
}

function writeDeviceInvites(invites: z.infer<typeof deviceInviteSchema>[]) {
  appSettingsRepository.set(deviceInvitesKey, JSON.stringify(deviceInvitesSchema.parse(invites)));
}

export function issueFamilyDeviceInvite(session: {
  memberId: string; sessionKey: string; generation: string; expiresAt: number;
}) {
  return mutate(members => {
    const now = Date.now();
    const member = members.find(value => value.id === session.memberId && !value.revokedAt);
    if (!member || session.expiresAt <= now || isFamilySessionEnded(session.sessionKey)) {
      throw new Error('Active family session required.');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(now + familyDeviceInviteLifetimeMs, session.expiresAt);
    const invites = readDeviceInvites().filter(invite =>
      invite.memberId !== member.id && invite.generation === session.generation && invite.expiresAt > now);
    invites.push({
      memberId: member.id, hash: createHash('sha256').update(token).digest('hex'),
      generation: session.generation, expiresAt, issuerSessionKey: session.sessionKey
    });
    writeDeviceInvites(invites);
    return { token, expiresAt };
  });
}
type Member = z.infer<typeof memberSchema>;
export type FamilyIdentity = Pick<Member, 'id' | 'name'>;
const nameSchema = memberSchema.shape.name;
export const familyInviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function readMembers(): Member[] {
  const raw = appSettingsRepository.get(key);
  // Corruption must not silently reset accounts or allow previous credentials.
  return raw === null || raw === undefined ? [] : membersSchema.parse(JSON.parse(raw));
}

function mutate<T>(fn: (members: Member[]) => T): T {
  const db = databaseManager.connection;
  db.exec('BEGIN IMMEDIATE');
  try {
    const members = readMembers();
    const result = fn(members);
    appSettingsRepository.set(key, JSON.stringify(membersSchema.parse(members)));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function safeMember(member: Member, generation: string | null) {
  const pending = Boolean(member.invite && member.invite.expiresAt > Date.now() && member.invite.generation === generation && !member.revokedAt);
  return {
    id: member.id, name: member.name, createdAt: member.createdAt,
    revokedAt: member.revokedAt, lastJoinedAt: member.lastJoinedAt,
    inviteExpiresAt: pending ? member.invite!.expiresAt : null
  };
}

function issue(member: Member, generation: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + familyInviteLifetimeMs;
  member.invite = { hash: createHash('sha256').update(token).digest('hex'), generation, expiresAt };
  return { member: safeMember(member, generation), token, expiresAt };
}

export function listFamilyMembers(generation: string | null) {
  return readMembers().map(member => safeMember(member, generation));
}

export function createFamilyMember(name: unknown, generation: string) {
  const checkedName = nameSchema.parse(name);
  return mutate(members => {
    if (members.length >= 100) throw new Error('Family member limit reached.');
    const member: Member = { id: randomUUID(), name: checkedName, createdAt: Date.now(), revokedAt: null, lastJoinedAt: null, invite: null };
    members.push(member);
    return issue(member, generation);
  });
}

export function renewFamilyInvite(id: string, generation: string) {
  return mutate(members => {
    const member = members.find(value => value.id === id && !value.revokedAt);
    if (!member) throw new Error('Active family member not found.');
    return issue(member, generation);
  });
}

export function revokeFamilyMember(id: string) {
  return mutate(members => {
    const member = members.find(value => value.id === id);
    if (!member) throw new Error('Family member not found.');
    member.revokedAt ??= Date.now();
    member.invite = null;
    return safeMember(member, null);
  });
}

export function getFamilyIdentity(id: string): FamilyIdentity | null {
  try {
    const member = readMembers().find(value => value.id === id && !value.revokedAt);
    return member ? { id: member.id, name: member.name } : null;
  } catch {
    return null;
  }
}

export function redeemFamilyInvite(token: string, generation: string): FamilyIdentity | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = createHash('sha256').update(token).digest();
  return mutate(members => {
    const member = members.find(value => {
      const invite = value.invite;
      return !value.revokedAt && invite && invite.expiresAt > Date.now() && invite.generation === generation
        && timingSafeEqual(Buffer.from(invite.hash, 'hex'), hash);
    });
    if (member) {
      member.invite = null;
      member.lastJoinedAt = Date.now();
      return { id: member.id, name: member.name };
    }
    const now = Date.now();
    const invites = readDeviceInvites().filter(invite =>
      invite.expiresAt > now && invite.generation === generation);
    const deviceInvite = invites.find(invite =>
      timingSafeEqual(Buffer.from(invite.hash, 'hex'), hash));
    if (!deviceInvite || isFamilySessionEnded(deviceInvite.issuerSessionKey)) return null;
    const linkedMember = members.find(value => value.id === deviceInvite.memberId && !value.revokedAt);
    if (!linkedMember) return null;
    writeDeviceInvites(invites.filter(invite => invite !== deviceInvite));
    linkedMember.lastJoinedAt = now;
    return { id: linkedMember.id, name: linkedMember.name };
  });
}