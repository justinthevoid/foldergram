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
    if (!member) return null;
    member.invite = null;
    member.lastJoinedAt = Date.now();
    return { id: member.id, name: member.name };
  });
}