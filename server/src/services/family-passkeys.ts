import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON
} from '@simplewebauthn/server';
import type express from 'express';
import { databaseManager } from '../db/database.js';
import { authService } from './auth-service.js';
import { getFamilyIdentity, type FamilyIdentity } from './family-service.js';
import { familyDeviceLabel, type FamilySessionReference } from './family-devices.js';

const db = () => databaseManager.connection;
const MAX_KEYS = 10;
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 512;
const challengeCookie = 'foldergram_passkey_challenge';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/api' };

interface PasskeyRow {
  id: string; credential_id: string; member_id: string; generation: string; origin: string;
  public_key: Uint8Array; counter: number; device_label: string;
  credential_device_type: 'singleDevice' | 'multiDevice'; backed_up: number;
  created_at: number; last_used_at: number | null;
}
interface Challenge {
  purpose: 'register' | 'authenticate';
  challenge: string;
  generation: string;
  origin: string;
  expiresAt: number;
  memberId?: string;
  sessionKey?: string;
}
const challenges = new Map<string, Challenge>();
const userHandle = (memberId: string) => Buffer.from(memberId, 'utf8').toString('base64url');

function readChallengeCookie(request: express.Request) {
  const matches = (request.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(challengeCookie + '='));
  const value = matches.length === 1 ? matches[0]!.slice(challengeCookie.length + 1) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function startChallenge(request: express.Request, response: express.Response, challenge: Omit<Challenge, 'expiresAt'>) {
  const now = Date.now();
  for (const [key, value] of challenges) if (value.expiresAt <= now) challenges.delete(key);
  const previous = readChallengeCookie(request);
  if (previous) challenges.delete(previous);
  if (challenges.size >= MAX_CHALLENGES) throw new Error('Passkey sign-in temporarily busy.');
  const id = randomBytes(32).toString('base64url');
  challenges.set(id, { ...challenge, expiresAt: now + CHALLENGE_MS });
  response.cookie(challengeCookie, id, { ...cookieOptions, maxAge: CHALLENGE_MS });
}
function consumeChallenge(request: express.Request, response: express.Response, purpose: Challenge['purpose'], origin: string, generation: string) {
  const id = readChallengeCookie(request);
  response.clearCookie(challengeCookie, cookieOptions);
  if (!id) return null;
  const value = challenges.get(id);
  challenges.delete(id);
  return value && value.expiresAt > Date.now() && value.purpose === purpose &&
    value.origin === origin && value.generation === generation ? value : null;
}
function memberRows(memberId: string, generation: string, origin: string): PasskeyRow[] {
  return db().prepare('SELECT * FROM family_passkeys WHERE member_id = ? AND generation = ? AND origin = ? ORDER BY created_at DESC')
    .all(memberId, generation, origin) as unknown as PasskeyRow[];
}
export function listFamilyPasskeys(memberId: string, generation: string, origin: string) {
  if (!getFamilyIdentity(memberId)) return [];
  return memberRows(memberId, generation, origin).map(row => ({
    id: row.id, label: row.device_label, createdAt: row.created_at, lastUsedAt: row.last_used_at,
    backedUp: Boolean(row.backed_up), synced: row.credential_device_type === 'multiDevice'
  }));
}
export function removeFamilyPasskey(memberId: string, generation: string, origin: string, id: string): boolean {
  if (!getFamilyIdentity(memberId)) return false;
  return db().prepare('DELETE FROM family_passkeys WHERE member_id = ? AND generation = ? AND origin = ? AND id = ?')
    .run(memberId, generation, origin, id).changes > 0;
}

function stillSameSession(request: express.Request, session: FamilySessionReference, origin: string) {
  const current = authService.getFamilyPushSession(request);
  return current?.sessionKey === session.sessionKey && current.memberId === session.memberId &&
    current.generation === session.generation && request.get('origin') === origin;
}
export async function startFamilyPasskeyRegistration(request: express.Request, response: express.Response, session: FamilySessionReference, origin: string) {
  const member = getFamilyIdentity(session.memberId);
  if (!member) throw new Error('Active family session required.');
  const rows = memberRows(member.id, session.generation, origin);
  if (rows.length >= MAX_KEYS) throw new Error('Passkey limit reached.');
  const options = await generateRegistrationOptions({
    rpName: 'Foldergram family gallery', rpID: new URL(origin).hostname,
    userName: member.name, userDisplayName: member.name, userID: Buffer.from(member.id, 'utf8'),
    attestationType: 'none', timeout: 120000,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: rows.map(row => ({ id: row.credential_id }))
  });
  if (!stillSameSession(request, session, origin)) throw new Error('Active family session required.');
  startChallenge(request, response, { purpose: 'register', challenge: options.challenge,
    generation: session.generation, origin, memberId: member.id, sessionKey: session.sessionKey });
  return options;
}
export async function finishFamilyPasskeyRegistration(request: express.Request, response: express.Response,
  session: FamilySessionReference, origin: string, credential: RegistrationResponseJSON) {
  const challenge = consumeChallenge(request, response, 'register', origin, session.generation);
  if (!challenge || challenge.memberId !== session.memberId || challenge.sessionKey !== session.sessionKey) return false;
  const result = await verifyRegistrationResponse({
    response: credential, expectedChallenge: challenge.challenge, expectedOrigin: origin,
    expectedRPID: new URL(origin).hostname, requireUserVerification: true, requireUserPresence: true
  });
  if (!result.verified || !result.registrationInfo || !stillSameSession(request, session, origin)) return false;
  const info = result.registrationInfo;
  if (!info.userVerified || memberRows(session.memberId, session.generation, origin).length >= MAX_KEYS) return false;
  const key = info.credential;
  if (key.id !== credential.id || !key.publicKey.length) return false;
  db().prepare(`INSERT INTO family_passkeys
    (id, credential_id, member_id, generation, origin, public_key, counter, device_label,
      credential_device_type, backed_up, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(randomUUID(), key.id,
    session.memberId, session.generation, origin, key.publicKey, key.counter,
    familyDeviceLabel(request.get('user-agent')), info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, Date.now());
  return true;
}
export async function startFamilyPasskeyAuthentication(request: express.Request, response: express.Response, generation: string, origin: string) {
  // Discoverable credentials allow account selection without disclosing a member roster.
  const options = await generateAuthenticationOptions({
    rpID: new URL(origin).hostname, userVerification: 'required', timeout: 120000
  });
  if (authService.getFamilyGeneration() !== generation || authService.isAuthenticatedRequest(request)) throw new Error('Sign-in unavailable.');
  startChallenge(request, response, { purpose: 'authenticate', challenge: options.challenge, generation, origin });
  return options;
}
export async function finishFamilyPasskeyAuthentication(request: express.Request, response: express.Response,
  generation: string, origin: string, credential: AuthenticationResponseJSON): Promise<FamilyIdentity | null> {
  const challenge = consumeChallenge(request, response, 'authenticate', origin, generation);
  if (!challenge) return null;
  const row = db().prepare('SELECT * FROM family_passkeys WHERE credential_id = ? AND generation = ? AND origin = ?')
    .get(credential.id, generation, origin) as unknown as PasskeyRow | undefined;
  if (!row || credential.response.userHandle !== userHandle(row.member_id) || !getFamilyIdentity(row.member_id)) return null;
  const result = await verifyAuthenticationResponse({
    response: credential, expectedChallenge: challenge.challenge, expectedOrigin: origin,
    expectedRPID: new URL(origin).hostname, requireUserVerification: true,
    credential: { id: row.credential_id, publicKey: new Uint8Array(row.public_key), counter: row.counter }
  });
  if (!result.verified || !result.authenticationInfo.userVerified ||
      result.authenticationInfo.credentialID !== row.credential_id ||
      authService.getFamilyGeneration() !== generation || authService.isAuthenticatedRequest(request)) return null;
  const member = getFamilyIdentity(row.member_id);
  if (!member) return null;
  // Recheck persistence after async signature verification: a removed key, or a
  // concurrent non-zero counter update, must not issue another session.
  const updated = db().prepare(`UPDATE family_passkeys SET counter = ?, credential_device_type = ?, backed_up = ?, last_used_at = ?
    WHERE id = ? AND generation = ? AND origin = ? AND counter = ?`).run(
    result.authenticationInfo.newCounter, result.authenticationInfo.credentialDeviceType,
    result.authenticationInfo.credentialBackedUp ? 1 : 0, Date.now(), row.id, generation, origin, row.counter);
  return updated.changes === 1 ? member : null;
}
