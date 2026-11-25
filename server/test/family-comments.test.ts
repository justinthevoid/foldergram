import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('family comments', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-comments-'));
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

  it('persists comments, enforces author and post scope, paginates, and supports owner moderation', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { databaseManager } = await import('../src/db/database.js');
    const { createFamilyMember, revokeFamilyMember } = await import('../src/services/family-service.js');
    const db = databaseManager.connection;
    const source = db.prepare("SELECT id FROM media_sources WHERE kind='local' LIMIT 1").get() as { id: number };
    db.prepare("INSERT INTO folders (id,slug,name,folder_path,source_id) VALUES (100,'fixture','Fixture','fixture',?)").run(source.id);
    for (const id of [100, 101]) {
      db.prepare(`
        INSERT INTO images (id,folder_id,filename,extension,relative_path,source_id,absolute_path,file_size,width,height,mime_type,checksum_or_fingerprint,mtime_ms,first_seen_at,sort_timestamp,thumbnail_path,preview_path)
        VALUES (?,100,?,'.jpg',?,?,?,100,800,600,'image/jpeg','fixture',1,'2025-01-01',1,'fixture/thumb.webp','fixture/preview.webp')
      `).run(id, id+'.jpg', 'fixture/'+id+'.jpg', source.id, 'fixture/'+id+'.jpg');
      db.prepare("INSERT INTO posts (id,folder_id,source_path,source_id,sort_timestamp) VALUES (?,100,?,?,1)").run(id, 'fixture/'+id+'.jpg', source.id);
      db.prepare("INSERT INTO post_items (post_id,image_id,position) VALUES (?,?,1)").run(id,id);
    }
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const url = '/api/family/posts/100/comments';
    expect((await requestTestApp(app, 'GET', url)).status).toBe(403);
    authService.setAdminPassword('fixture-admin-password');
    authService.setViewerAccess('password', 'fixture-viewer-password');
    const cookie = (res: Awaited<ReturnType<typeof requestTestApp>>) => ({ ...intent, Cookie: res.headers.get('set-cookie')!.split(';', 1)[0]! });
    const login = async (password: string) => {
      const res = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password });
      expect(res.status).toBe(200);
      return cookie(res);
    };
    const admin = await login('fixture-admin-password');
    const shared = await login('fixture-viewer-password');
    const generation = authService.getFamilyGeneration()!;
    const alice = createFamilyMember('Alice', generation);
    const bob = createFamilyMember('Bob', generation);
    const redeem = async (token: string) => {
      const res = await requestTestApp(app, 'POST', '/api/auth/family-invite', intent, { token });
      expect(res.status).toBe(200);
      return cookie(res);
    };
    const A = await redeem(alice.token), B = await redeem(bob.token);
    expect((await requestTestApp(app, 'GET', url)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', url, shared)).status).toBe(403);
    expect((await requestTestApp(app, 'POST', url, { Cookie: A.Cookie }, { body: 'Hi' })).status).toBe(403);
    expect((await requestTestApp(app, 'POST', url, A, { body: 'Hi', authorName: 'Bob' })).status).toBe(400);
    expect((await requestTestApp(app, 'POST', url, A, { body: '  ' })).status).toBe(400);
    expect((await requestTestApp(app, 'POST', url, A, { body: 'x'.repeat(1001) })).status).toBe(400);
    const a = await requestTestApp(app, 'POST', url, A, { body: '  <script>literal text</script>  ' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ authorName: 'Alice', body: '<script>literal text</script>', canEdit: true, canDelete: true, isOwner: false });
    expect(a.body).not.toHaveProperty('author_key');
    expect(a.body).not.toHaveProperty('memberId');
    expect(JSON.stringify(a.body)).not.toContain(alice.member.id);
    const item = url+'/'+a.body.id;
    const b = await requestTestApp(app, 'POST', url, B, { body: 'Lovely photo!' });
    expect(b.status).toBe(201);
    const owner = await requestTestApp(app, 'POST', url, admin, { body: 'Thank you!' });
    expect(owner.status).toBe(201);
    expect(owner.body.isOwner).toBe(true);
    const first = await requestTestApp(app, 'GET', url+'?limit=2', A);
    expect(first.body.items.map((c: {id: number}) => c.id)).toEqual([owner.body.id,b.body.id]);
    expect(first.body.nextBeforeId).toBe(b.body.id);
    const second = await requestTestApp(app, 'GET', url+'?limit=2&beforeId='+first.body.nextBeforeId, A);
    expect(second.body.items.map((c: {id: number}) => c.id)).toEqual([a.body.id]);
    expect(second.body.nextBeforeId).toBeNull();
    expect((await requestTestApp(app, 'GET', url+'?limit=51', A)).status).toBe(400);
    expect((await requestTestApp(app, 'PATCH', item, B, { body: 'Impersonation' })).status).toBe(403);
    expect((await requestTestApp(app, 'PATCH', item, admin, { body: 'Moderation edit' })).status).toBe(403);
    expect((await requestTestApp(app, 'DELETE', item, B)).status).toBe(403);
    expect((await requestTestApp(app, 'PATCH', '/api/family/posts/101/comments/'+a.body.id, A, { body: 'Wrong post' })).status).toBe(404);
    expect((await requestTestApp(app, 'PATCH', item, A, { body: 'Edited!' })).body).toMatchObject({ body: 'Edited!', updatedAt: expect.any(Number) });
    const list = await requestTestApp(app, 'GET', url, B);
    expect(list.body.items.find((c: {id: number}) => c.id===a.body.id)).toMatchObject({ canEdit: false, canDelete: false, body: 'Edited!' });
    expect((await requestTestApp(app, 'GET', url, admin)).body.items.find((c: {id: number}) => c.id===a.body.id)).toMatchObject({ canEdit: false, canDelete: true });
    revokeFamilyMember(alice.member.id);
    expect((await requestTestApp(app, 'GET', url, A)).status).toBe(401);
    expect((await requestTestApp(app, 'DELETE', item, A)).status).toBe(401);
    expect((await requestTestApp(app, 'GET', url, B)).body.items.some((c: {id: number}) => c.id===a.body.id)).toBe(true);
    expect((await requestTestApp(app, 'DELETE', item, admin)).status).toBe(200);
    db.exec('UPDATE posts SET is_trashed=1 WHERE id=100');
    expect((await requestTestApp(app, 'GET', url, B)).status).toBe(404);
    expect((await requestTestApp(app, 'POST', url, B, { body: 'Hidden' })).status).toBe(404);
    db.exec('UPDATE posts SET is_trashed=0 WHERE id=100');
    databaseManager.close();
    expect((await requestTestApp(app, 'GET', url, B)).body.items).toHaveLength(2);
    databaseManager.connection.exec('DELETE FROM posts WHERE id=100');
    expect(databaseManager.connection.prepare('SELECT COUNT(*) AS count FROM family_comments').get()).toMatchObject({ count: 0 });
    authService.setViewerAccess('public');
    expect((await requestTestApp(app, 'GET', '/api/family/posts/101/comments')).status).toBe(403);
    authService.disable();
    expect((await requestTestApp(app, 'GET', '/api/family/posts/101/comments')).status).toBe(403);
  });
});