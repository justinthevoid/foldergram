import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('named family reactions', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-reactions-'));
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) {
      const folder = path.join(tempRoot, directory);
      await fs.mkdir(folder, { recursive: true });
      vi.stubEnv(key, folder);
    }
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

  it('separates reactions by authenticated identity and keeps names private to the administrator', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { databaseManager } = await import('../src/db/database.js');
    const { familyReactionRepository } = await import('../src/db/repositories.js');
    const { createFamilyMember, revokeFamilyMember } = await import('../src/services/family-service.js');
    const db = databaseManager.connection;
    const source = db.prepare("SELECT id FROM media_sources WHERE kind='local' LIMIT 1").get() as { id: number };
    db.prepare("INSERT INTO folders (id,slug,name,folder_path,source_id) VALUES (100,'fixture','Fixture','fixture',?)").run(source.id);
    db.prepare(`
      INSERT INTO images (id,folder_id,filename,extension,relative_path,source_id,absolute_path,file_size,width,height,mime_type,checksum_or_fingerprint,mtime_ms,first_seen_at,sort_timestamp,thumbnail_path,preview_path)
      VALUES (100,100,'photo.jpg','.jpg','fixture/photo.jpg',?,'fixture/photo.jpg',100,800,600,'image/jpeg','fixture',1,'2025-01-01',1,'fixture/thumb.webp','fixture/preview.webp')
    `).run(source.id);
    db.prepare("INSERT INTO posts (id,folder_id,source_path,source_id,sort_timestamp) VALUES (100,100,'fixture/photo.jpg',?,1)").run(source.id);
    db.exec("INSERT INTO post_items (post_id,image_id,position) VALUES (100,100,1); INSERT INTO likes (post_id) VALUES (100)");
    expect(familyReactionRepository.visiblePost(100)).toBe(true);

    authService.setAdminPassword('fixture-admin-password');
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const cookie = (res: Awaited<ReturnType<typeof requestTestApp>>) => ({ ...intent, Cookie: res.headers.get('set-cookie')!.split(';', 1)[0]! });
    const login = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password: 'fixture-admin-password' });
    expect(login.status).toBe(200);
    const admin = cookie(login);
    const generation = authService.getFamilyGeneration()!;
    const alice = createFamilyMember('Alice', generation);
    const bob = createFamilyMember('Bob', generation);
    const a = await requestTestApp(app, 'POST', '/api/auth/family-invite', intent, { token: alice.token });
    const b = await requestTestApp(app, 'POST', '/api/auth/family-invite', intent, { token: bob.token });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const A = cookie(a), B = cookie(b);
    const like = '/api/family/posts/100/like';
    const summary = '/api/admin/family/reactions?ids=100';
    expect((await requestTestApp(app, 'PUT', like, intent, { liked: true })).status).toBe(401);
    expect((await requestTestApp(app, 'PUT', like, admin, { liked: true })).status).toBe(403);
    expect((await requestTestApp(app, 'PUT', like, { Cookie: A.Cookie }, { liked: true })).status).toBe(403);
    expect((await requestTestApp(app, 'PUT', like, A, { liked: true, memberId: bob.member.id })).status).toBe(400);
    expect((await requestTestApp(app, 'PUT', like, A, { liked: true })).status).toBe(200);
    expect((await requestTestApp(app, 'PUT', like, A, { liked: true })).status).toBe(200);
    expect((await requestTestApp(app, 'GET', '/api/family/likes', A)).body.items.map((item: { id: number }) => item.id)).toEqual([100]);
    expect((await requestTestApp(app, 'GET', '/api/family/likes', B)).body.items).toEqual([]);
    expect((await requestTestApp(app, 'PUT', like, B, { liked: true })).status).toBe(200);
    expect((await requestTestApp(app, 'GET', summary, A)).status).toBe(403);
    expect((await requestTestApp(app, 'GET', summary)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', summary, admin)).body.items['100'].sort()).toEqual(['Alice', 'Bob']);
    expect((await requestTestApp(app, 'PUT', like, A, { liked: false })).status).toBe(200);
    expect((await requestTestApp(app, 'GET', summary, admin)).body.items['100']).toEqual(['Bob']);
    expect((await requestTestApp(app, 'GET', '/api/family/likes', A)).body.items).toEqual([]);
    expect((await requestTestApp(app, 'GET', '/api/likes', admin)).body.items.map((item: { id: number }) => item.id)).toEqual([100]);
    expect((await requestTestApp(app, 'PUT', '/api/family/posts/999/like', B, { liked: true })).status).toBe(404);
    db.exec('UPDATE posts SET is_trashed=1 WHERE id=100');
    expect((await requestTestApp(app, 'PUT', like, B, { liked: true })).status).toBe(404);
    expect((await requestTestApp(app, 'GET', summary, admin)).body.items['100']).toEqual([]);
    db.exec('UPDATE posts SET is_trashed=0 WHERE id=100');
    revokeFamilyMember(bob.member.id);
    expect((await requestTestApp(app, 'PUT', like, B, { liked: false })).status).toBe(401);
    // Revocation prevents new access but preserves historical reactions for the owner.
    expect((await requestTestApp(app, 'GET', summary, admin)).body.items['100']).toEqual(['Bob']);
    db.exec('DELETE FROM posts WHERE id=100');
    expect(db.prepare('SELECT COUNT(*) AS count FROM family_reactions').get()).toMatchObject({ count: 0 });
    authService.setViewerAccess('public');
    expect((await requestTestApp(app, 'GET', summary)).status).toBe(401);
  });
});