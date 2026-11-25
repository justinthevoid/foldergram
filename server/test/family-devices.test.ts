import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('family device management', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-devices-'));
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) {
      const folder = path.join(tempRoot, directory);
      await fs.mkdir(folder, { recursive: true });
      vi.stubEnv(key, folder);
    }
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CSRF_TRUSTED_ORIGINS', 'https://gallery.example.test');
    vi.stubEnv('FAMILY_INVITE_BASE_URL', 'https://gallery.example.test');
    vi.stubEnv('PUBLIC_DEMO_MODE', '0');
    vi.resetModules();
  });
  afterAll(async () => {
    const { databaseManager } = await import('../src/db/database.js');
    databaseManager.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('isolates device lists, migrates returning sessions and revokes one device without affecting other devices', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { createFamilyMember, renewFamilyInvite } = await import('../src/services/family-service.js');
    const { databaseManager } = await import('../src/db/database.js');
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const edge = { ...intent, Host: 'gallery.example.test', Origin: 'https://gallery.example.test',
      'x-foldergram-external': '1', 'x-forwarded-proto': 'https' };
    authService.setAdminPassword('fixture-admin-password');
    const generation = authService.getFamilyGeneration()!;
    const alice = createFamilyMember('Alice', generation);
    const bob = createFamilyMember('Bob', generation);
    const join = async (token: string, agent: string) => {
      const headers = { ...edge, 'User-Agent': agent };
      const result = await requestTestApp(app, 'POST', '/api/auth/family-invite', headers, { token });
      expect(result.status).toBe(200);
      return { ...headers, Cookie: result.headers.get('set-cookie')!.split(';', 1)[0]! };
    };
    const phone = await join(alice.token, 'Mozilla iPhone');
    const ipad = await join(renewFamilyInvite(alice.member.id, generation).token, 'Mozilla iPad');
    const other = await join(bob.token, 'Mozilla Windows');
    const endpoint = '/api/family/devices';
    const list = (headers: typeof phone) => requestTestApp(app, 'GET', endpoint, headers);
    expect((await requestTestApp(app, 'GET', endpoint, edge)).status).toBe(401);
    const listed = await list(phone);
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toContain('no-store');
    const current = listed.body.items.find((device: { current: boolean }) => device.current);
    const remote = listed.body.items.find((device: { current: boolean }) => !device.current);
    expect(current).toMatchObject({ label: 'iphone', current: true });
    expect(remote).toMatchObject({ label: 'ipad', current: false });
    expect(listed.body.items).toHaveLength(2);
    expect(JSON.stringify(listed.body)).not.toContain('session_key');
    expect(JSON.stringify(listed.body)).not.toContain('Mozilla');
    expect((await list(other)).body.items).toHaveLength(1);
    const bobId = (await list(other)).body.items[0].id;
    expect((await requestTestApp(app, 'DELETE', endpoint + '/' + bobId, phone)).status).toBe(404);
    expect((await requestTestApp(app, 'DELETE', endpoint + '/' + current.id, phone)).status).toBe(409);
    expect((await requestTestApp(app, 'DELETE', endpoint + '/' + remote.id, { ...phone, Origin: 'https://other.example.test' })).status).toBe(403);
    const pending = await requestTestApp(app, 'POST', '/api/family/device-invite', ipad, {});
    expect(pending.status).toBe(200);
    expect((await requestTestApp(app, 'DELETE', endpoint + '/' + remote.id, phone)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', '/api/feed', ipad)).status).toBe(401);
    expect((await requestTestApp(app, 'POST', '/api/auth/family-invite', edge, { token: pending.body.token })).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/feed', phone)).status).toBe(200);
    expect((await list(phone)).body.items).toHaveLength(1);
    // Simulate a pre-registry cookie: it becomes visible when its browser returns.
    databaseManager.connection.prepare('DELETE FROM family_device_sessions WHERE member_id = ?').run(bob.member.id);
    expect((await requestTestApp(app, 'GET', '/api/auth/status', other)).body.familyMember.id).toBe(bob.member.id);
    expect((await list(other)).body.items).toHaveLength(1);
    const login = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password: 'fixture-admin-password' });
    const admin = { ...intent, Cookie: login.headers.get('set-cookie')!.split(';', 1)[0]! };
    const adminPath = '/api/admin/family/' + alice.member.id + '/devices';
    expect((await requestTestApp(app, 'GET', adminPath, phone)).status).toBe(403);
    const adminList = await requestTestApp(app, 'GET', adminPath, admin);
    expect(adminList.body.items).toHaveLength(1);
    expect((await requestTestApp(app, 'DELETE', adminPath + '/' + bobId, admin)).status).toBe(404);
    expect((await requestTestApp(app, 'DELETE', adminPath + '/' + current.id, admin)).status).toBe(200);
    databaseManager.close();
    expect((await requestTestApp(app, 'GET', '/api/feed', phone)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/feed', other)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', adminPath, admin)).body.items).toEqual([]);
  });
});
