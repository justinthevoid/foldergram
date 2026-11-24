import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { requestTestApp } from './http-test-utils.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe.sequential('gallery branding permissions and persistence', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-branding-'));
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
  it('keeps private profile text off the public endpoint, permits admin edits, and normalizes raster logos', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { databaseManager } = await import('../src/db/database.js');
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const target = '/api/admin/settings/branding';
    authService.setAdminPassword('fixture-admin-password');
    authService.setViewerAccess('password', 'fixture-viewer-password');
    const signIn = async (password: string) => {
      const result = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password });
      expect(result.status).toBe(200);
      return { ...intent, Cookie: result.headers.get('set-cookie')!.split(';', 1)[0] };
    };
    expect(await requestTestApp(app, 'GET', '/api/branding')).toMatchObject({ status: 200, body: { name: 'Foldergram', logo: '' } });
    expect((await requestTestApp(app, 'GET', '/api/branding/profile')).status).toBe(401);
    const logo = 'data:image/png;base64,' + (await sharp({ create: { width: 48, height: 32, channels: 4, background: '#334455' } }).png().toBuffer()).toString('base64');
    const input = { name: 'Field Notes', photographer: 'Test photographer', bio: 'Private test profile', logo };
    expect((await requestTestApp(app, 'PUT', target, intent, input)).status).toBe(401);
    const viewer = await signIn('fixture-viewer-password');
    expect((await requestTestApp(app, 'PUT', target, viewer, input)).status).toBe(403);
    const admin = await signIn('fixture-admin-password');
    expect((await requestTestApp(app, 'PUT', target, { Cookie: admin.Cookie }, input)).status).toBe(403);
    expect((await requestTestApp(app, 'PUT', target, admin, { ...input, logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
    expect((await requestTestApp(app, 'PUT', target, admin, { ...input, logo: 'data:image/png;base64,YWJj' })).status).toBe(400);
    const saved = await requestTestApp(app, 'PUT', target, admin, input);
    expect(saved.status).toBe(200);
    expect(saved.body.logo).toMatch(/^data:image\/webp;base64,/);
    const image = await sharp(Buffer.from(saved.body.logo.split(',')[1], 'base64')).metadata();
    expect(image).toMatchObject({ width: 160, height: 160, format: 'webp' });
    databaseManager.close();
    const publicResponse = await requestTestApp(app, 'GET', '/api/branding');
    expect(publicResponse.body).toEqual({ name: input.name, logo: saved.body.logo });
    expect((await requestTestApp(app, 'GET', '/api/branding/profile')).status).toBe(401);
    expect(await requestTestApp(app, 'GET', '/api/branding/profile', viewer))
      .toMatchObject({ status: 200, body: { name: input.name, photographer: input.photographer, bio: input.bio } });
  });
});