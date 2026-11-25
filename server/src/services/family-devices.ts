import { randomUUID } from 'node:crypto';
import { databaseManager } from '../db/database.js';
import { getFamilyIdentity, isFamilySessionEnded } from './family-service.js';

export interface FamilySessionReference {
  memberId: string;
  sessionKey: string;
  generation: string;
  expiresAt: number;
}

interface SessionRow {
  session_key: string;
  id: string;
  member_id: string;
  generation: string;
  device_label: string;
  first_seen_at: number;
  expires_at: number;
}

const db = () => databaseManager.connection;

// Coarse platform names only. Never persist a raw user agent or IP address.
export function familyDeviceLabel(userAgent = ''): string {
  if (/iPad/i.test(userAgent)) return 'ipad';
  if (/iPhone|iPod/i.test(userAgent)) return 'iphone';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'mac';
  if (/Linux/i.test(userAgent)) return 'linux';
  return 'browser';
}

export function rememberFamilySession(session: FamilySessionReference, userAgent?: string): void {
  const now = Date.now();
  if (session.expiresAt <= now || !getFamilyIdentity(session.memberId) || isFamilySessionEnded(session.sessionKey)) return;
  const connection = db();
  connection.prepare('DELETE FROM family_device_sessions WHERE expires_at <= ? OR generation <> ?').run(now, session.generation);
  connection.prepare(`INSERT OR IGNORE INTO family_device_sessions
    (session_key, id, member_id, generation, device_label, first_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(session.sessionKey, randomUUID(), session.memberId,
    session.generation, familyDeviceLabel(userAgent), now, session.expiresAt);
}

export function listFamilyDevices(memberId: string, generation: string, currentSessionKey?: string) {
  if (!getFamilyIdentity(memberId)) return [];
  const rows = db().prepare(`SELECT s.* FROM family_device_sessions s
    WHERE s.member_id = ? AND s.generation = ? AND s.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM family_push_ended_sessions e WHERE e.session_key = s.session_key)
    ORDER BY s.first_seen_at DESC, s.id`).all(memberId, generation, Date.now()) as unknown as SessionRow[];
  return rows.map(row => ({
    id: row.id, label: row.device_label, firstSeenAt: row.first_seen_at,
    expiresAt: row.expires_at, current: row.session_key === currentSessionKey
  }));
}

export function findFamilyDevice(memberId: string, generation: string, id: string): FamilySessionReference | null {
  if (!getFamilyIdentity(memberId)) return null;
  const row = db().prepare(`SELECT s.* FROM family_device_sessions s
    WHERE s.member_id = ? AND s.generation = ? AND s.id = ? AND s.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM family_push_ended_sessions e WHERE e.session_key = s.session_key)`)
    .get(memberId, generation, id, Date.now()) as unknown as SessionRow | undefined;
  return row ? { memberId: row.member_id, sessionKey: row.session_key,
    generation: row.generation, expiresAt: row.expires_at } : null;
}
