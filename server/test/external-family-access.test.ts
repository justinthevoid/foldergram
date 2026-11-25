import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('external family access', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-external-family-'));
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) {
      const folder = path.join(tempRoot, directory);
      await fs.mkdir(folder, { recursive: true });
      vi.stubEnv(key, folder);
    }
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CSRF_TRUSTED_ORIGINS', 'https://gallery.example.test');
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

  it('requires a private named family session on the external ingress', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { createFamilyMember, revokeFamilyMember } = await import('../src/services/family-service.js');
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const edge = { ...intent, Host: 'gallery.example.test', Origin: 'https://gallery.example.test', 'x-foldergram-external': '1', 'x-forwarded-proto': 'https' };
    vi.stubEnv('FAMILY_INVITE_BASE_URL', 'https://gallery.example.test');
    expect((await requestTestApp(app, 'GET', '/api/feed', edge)).status).toBe(403);
    authService.setAdminPassword('fixture-admin-password');
    const login = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password: 'fixture-admin-password' });
    expect(login.status).toBe(200);
    const admin = { Cookie: login.headers.get('set-cookie')!.split(';',1)[0]! };
    expect((await requestTestApp(app, 'GET', '/api/auth/status', edge)).body).toMatchObject({role:'anonymous',externalFamilyAccess:true});
    expect((await requestTestApp(app, 'GET', '/api/auth/status', {...edge,...admin})).body.role).toBe('anonymous');
    expect((await requestTestApp(app, 'GET', '/api/feed', edge)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/feed', {...edge,...admin})).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/admin/family', admin)).status).toBe(200);
    const issued = createFamilyMember('Alice',authService.getFamilyGeneration()!);
    expect((await requestTestApp(app,'GET','/api/auth/status',{...edge,Host:'other.example.test'})).status).toBe(403);
    expect((await requestTestApp(app,'GET','/api/auth/status',{...edge,'x-forwarded-proto':'http'})).status).toBe(403);
    expect((await requestTestApp(app,'POST','/api/auth/family-invite',{...edge,Origin:'https://other.example.test'},{token:issued.token})).status).toBe(403);
    expect((await requestTestApp(app,'POST','/api/auth/family-invite',{...edge,Origin:''},{token:issued.token})).status).toBe(403);
    const accepted = await requestTestApp(app,'POST','/api/auth/family-invite',edge,{token:issued.token});
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('set-cookie')).toContain('Secure');
    expect(accepted.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await requestTestApp(app,'POST','/api/auth/family-invite',edge,{token:issued.token})).status).toBe(401);
    const viewer = {...edge,Cookie:accepted.headers.get('set-cookie')!.split(';',1)[0]!};
    expect((await requestTestApp(app,'GET','/api/auth/status',viewer)).body).toMatchObject({role:'viewer',externalFamilyAccess:true,familyMember:{name:'Alice'}});
    expect((await requestTestApp(app,'GET','/api/feed',viewer)).status).toBe(200);
    expect((await requestTestApp(app,'GET','/api/family/likes',viewer)).status).toBe(200);
    expect((await requestTestApp(app,'GET','/api/admin/family',viewer)).status).toBe(403);
    expect((await requestTestApp(app,'GET','/api/share/folders/test',viewer)).status).toBe(403);
    expect((await requestTestApp(app,'GET','/api/originals/1',viewer)).status).toBe(403);
    expect((await requestTestApp(app,'POST','/api/auth/unlock-admin',viewer,{password:'fixture-admin-password'})).status).toBe(403);
    expect((await requestTestApp(app,'DELETE','/api/posts/1',viewer)).status).toBe(403);
    revokeFamilyMember(issued.member.id);
    expect((await requestTestApp(app,'GET','/api/feed',viewer)).status).toBe(401);
    authService.setViewerAccess('public');
    expect((await requestTestApp(app,'GET','/api/feed',viewer)).status).toBe(403);
    authService.disable();
    expect((await requestTestApp(app,'GET','/api/feed',viewer)).status).toBe(403);
  });

  it('links another device to the same family identity with bounded, independently revocable sessions', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { createFamilyMember, renewFamilyInvite, listFamilyMembers, revokeFamilyMember } = await import('../src/services/family-service.js');
    const { appSettingsRepository } = await import('../src/db/repositories.js');
    const app = createApp();
    const edge = { 'x-foldergram-intent': '1', Host: 'gallery.example.test', Origin: 'https://gallery.example.test',
      'x-foldergram-external': '1', 'x-forwarded-proto': 'https' };
    vi.stubEnv('FAMILY_INVITE_BASE_URL', 'https://gallery.example.test');
    authService.setAdminPassword('fixture-device-admin-password');
    const generation = authService.getFamilyGeneration()!;
    const original = createFamilyMember('Linked family', generation);
    const endpoint = '/api/family/device-invite';
    const redeem = '/api/auth/family-invite';
    const join = (token: string) => requestTestApp(app, 'POST', redeem, edge, { token });
    const issue = (headers: typeof edge & { Cookie: string }) => requestTestApp(app, 'POST', endpoint, headers, {});
    const session = (response: Awaited<ReturnType<typeof join>>) => ({ ...edge, Cookie: response.headers.get('set-cookie')!.split(';', 1)[0]! });
    expect((await requestTestApp(app, 'POST', endpoint, edge, {})).status).toBe(401);
    const first = await join(original.token);
    expect(first.status).toBe(200);
    expect(first.headers.get('set-cookie')).toContain('Max-Age=31536000');
    const phone = session(first);
    const administratorInvite = renewFamilyInvite(original.member.id, generation);
    expect((await requestTestApp(app, 'POST', endpoint, { ...phone, Origin: 'https://wrong.example.test' }, {})).status).toBe(403);
    expect((await requestTestApp(app, 'POST', endpoint, phone, { memberId: 'other' })).status).toBe(400);
    const obsolete = await issue(phone);
    expect(obsolete.status).toBe(200);
    const paired = await issue(phone);
    expect(paired.status).toBe(200);
    expect(paired.body.origin).toBe('https://gallery.example.test');
    expect(paired.body.expiresAt - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(paired.body.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(paired.headers.get('cache-control')).toContain('no-store');
    expect(appSettingsRepository.get('app.family-device-invites.v1')).not.toContain(paired.body.token);
    expect(listFamilyMembers(generation).find(member => member.id === original.member.id)?.inviteExpiresAt).toBe(administratorInvite.expiresAt);
    expect((await join(obsolete.body.token)).status).toBe(401);
    const second = await join(paired.body.token);
    expect(second.status).toBe(200);
    expect(second.body.auth.familyMember.id).toBe(original.member.id);
    const tablet = session(second);
    expect(tablet.Cookie).not.toBe(phone.Cookie);
    expect((await join(paired.body.token)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/feed', phone)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', '/api/feed', tablet)).status).toBe(200);
    const pending = await issue(phone);
    expect(pending.status).toBe(200);
    expect((await requestTestApp(app, 'POST', '/api/auth/logout', phone)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', '/api/feed', phone)).status).toBe(401);
    expect((await issue(phone)).status).toBe(401);
    expect((await join(pending.body.token)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/feed', tablet)).status).toBe(200);
    const expiring = await issue(tablet);
    expect(expiring.status).toBe(200);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiring.body.expiresAt + 1);
    try {
      expect((await join(expiring.body.token)).status).toBe(401);
      expect((await requestTestApp(app, 'GET', '/api/feed', tablet)).status).toBe(200);
    } finally { clock.mockRestore(); }
    const third = await join(administratorInvite.token);
    expect(third.status).toBe(200);
    expect(third.body.auth.familyMember.id).toBe(original.member.id);
    const last = await issue(tablet);
    expect(last.status).toBe(200);
    revokeFamilyMember(original.member.id);
    expect((await requestTestApp(app, 'GET', '/api/feed', tablet)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', '/api/feed', session(third))).status).toBe(401);
    expect((await join(last.body.token)).status).toBe(401);
  });
});