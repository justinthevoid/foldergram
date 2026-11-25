import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestTestApp } from './http-test-utils.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe.sequential('family invitation access', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-'));
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) vi.stubEnv(key, path.join(tempRoot, directory));
    vi.stubEnv('NODE_ENV', 'test');
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

  it('issues one-time invitations, denies admin capabilities, persists identities, and revokes all access', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { appSettingsRepository } = await import('../src/db/repositories.js');
    const { databaseManager } = await import('../src/db/database.js');
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const create = '/api/admin/family';
    const redeem = '/api/auth/family-invite';

    expect((await requestTestApp(app, 'POST', create, intent, { name: 'Example' })).status).toBe(400);
    authService.setAdminPassword('fixture-admin-password');
    expect((await requestTestApp(app, 'GET', create)).status).toBe(401);
    expect((await requestTestApp(app, 'POST', create, intent, { name: 'Example' })).status).toBe(401);
    const login = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password: 'fixture-admin-password' });
    expect(login.status).toBe(200);
    const admin = { ...intent, Cookie: login.headers.get('set-cookie')!.split(';', 1)[0]! };
    expect((await requestTestApp(app, 'POST', create, { Cookie: admin.Cookie }, { name: 'Example' })).status).toBe(403);
    const created = await requestTestApp(app, 'POST', create, admin, { name: 'Example' });
    expect(created.status).toBe(201);
    const { member, token } = created.body;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(member.name).toBe('Example');
    expect(appSettingsRepository.get('app.family-members.v1')).not.toContain(token);
    const listing = await requestTestApp(app, 'GET', create, admin);
    expect(listing.body.members).toEqual([member]);
    expect(JSON.stringify(listing.body)).not.toContain(token);
    expect(JSON.stringify(listing.body)).not.toContain('"hash"');
    expect(JSON.stringify(listing.body)).not.toContain('"generation"');
    expect((await requestTestApp(app, 'POST', redeem, admin, { token })).status).toBe(409);

    const renewed = await requestTestApp(app, 'POST', create + '/' + member.id + '/invite', admin);
    expect(renewed.status).toBe(200);
    expect(renewed.body.member.id).toBe(member.id);
    expect(renewed.body.token).not.toBe(token);
    expect((await requestTestApp(app, 'POST', redeem, intent, { token })).status).toBe(401);
    expect((await requestTestApp(app, 'POST', redeem, {}, { token: renewed.body.token })).status).toBe(403);
    const accepted = await requestTestApp(app, 'POST', redeem, { ...intent, 'x-forwarded-proto': 'https' }, { token: renewed.body.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.auth).toMatchObject({
      authenticated: true, role: 'viewer', likesMode: 'family', familyMember: { id: member.id, name: 'Example' },
      capabilities: { canManageLibrary: false, canDeleteMedia: false, canAccessSettings: false, canUseSharedLikes: false, canUseLocalFavorites: false }
    });
    const cookie = accepted.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=31536000');
    const viewer = { ...intent, Cookie: cookie.split(';', 1)[0]! };
    expect((await requestTestApp(app, 'POST', redeem, intent, { token: renewed.body.token })).status).toBe(401);
    databaseManager.close();
    expect(await requestTestApp(app, 'GET', '/api/auth/status', viewer)).toMatchObject({
      status: 200, body: { familyMember: { id: member.id, name: 'Example' }, role: 'viewer' }
    });
    expect((await requestTestApp(app, 'GET', '/api/feed', viewer)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', create, viewer)).status).toBe(403);
    expect((await requestTestApp(app, 'POST', '/api/posts/1/like', viewer)).status).toBe(403);
    expect((await requestTestApp(app, 'POST', create + '/' + member.id + '/revoke', admin)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', '/api/feed', viewer)).status).toBe(401);
    expect((await requestTestApp(app, 'POST', create + '/' + member.id + '/invite', admin)).status).toBe(400);
    expect((await requestTestApp(app, 'GET', '/api/auth/status', admin)).body.role).toBe('admin');
  });

  it('expires invitations and binds them to the current authentication generation', async () => {
    const family = await import('../src/services/family-service.js');
    const { authService } = await import('../src/services/auth-service.js');
    const generation = authService.getFamilyGeneration()!;
    const issued = family.createFamilyMember('Expired', generation);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(issued.expiresAt + 1);
    try {
      expect(family.redeemFamilyInvite(issued.token, generation)).toBeNull();
      expect(family.listFamilyMembers(generation).find(m => m.id === issued.member.id)?.inviteExpiresAt).toBeNull();
    } finally { clock.mockRestore(); }
    const pending = family.createFamilyMember('Rotated', generation);
    authService.setAdminPassword('fixture-new-password');
    expect(authService.getFamilyGeneration()).not.toBe(generation);
    expect(family.redeemFamilyInvite(pending.token, authService.getFamilyGeneration()!)).toBeNull();
    authService.setViewerAccess('public');
    expect(authService.getFamilyGeneration()).toBeNull();
  });
});