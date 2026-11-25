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
});