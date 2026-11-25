import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('private family activity', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-activity-'));
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

  it('tracks current family activity and independent read states privately', async () => {
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
    const inbox='/api/admin/activity';
    const read=inbox+'/read';
    const comments='/api/family/posts/100/comments';
    const get=(url=inbox,headers=admin)=>requestTestApp(app,'GET',url,headers);
    const mark=(body:unknown,headers=admin)=>requestTestApp(app,'POST',read,headers,body);
    expect((await get(inbox,intent)).status).toBe(401);
    expect((await get(inbox,A)).status).toBe(403);
    expect((await mark({throughId:0},A)).status).toBe(403);
    expect((await get(inbox,{...admin,'x-foldergram-external':'1'})).status).toBe(403);
    expect((await get()).body).toEqual({items:[],unread:0,snapshot:0,nextBeforeId:null});
    expect((await requestTestApp(app,'PUT',like,A,{liked:true})).status).toBe(200);
    expect((await requestTestApp(app,'PUT',like,A,{liked:true})).status).toBe(200);
    const first=(await get()).body;
    expect(first.unread).toBe(1);
    expect(first.items).toMatchObject([{kind:'like',memberName:'Alice',postId:100,readAt:null,body:null,thumbnailUrl:'/thumbnails/fixture/thumb.webp'}]);
    expect(first.items[0]).not.toHaveProperty('memberId');
    const comment=await requestTestApp(app,'POST',comments,B,{body:'Lovely photo!'});
    expect(comment.status).toBe(201);
    expect((await requestTestApp(app,'POST',comments,admin,{body:'Thank you!'})).status).toBe(201);
    const latest=(await get(inbox+'?limit=1')).body;
    expect(latest.unread).toBe(2);
    expect(latest.items).toMatchObject([{kind:'comment',memberName:'Bob',body:'Lovely photo!',postId:100}]);
    expect(latest.nextBeforeId).toBe(latest.items[0].id);
    expect((await get(inbox+'?beforeId='+latest.nextBeforeId)).body.items).toEqual(first.items);
    expect((await mark({id:first.items[0].id},{Cookie:admin.Cookie} as typeof admin)).status).toBe(403);
    expect((await mark({throughId:first.snapshot})).body).toEqual({changed:1,unread:1});
    expect((await get(inbox+'?filter=unread')).body.items).toMatchObject([{kind:'comment',memberName:'Bob'}]);
    expect((await mark({id:latest.items[0].id})).body).toEqual({changed:1,unread:0});
    expect((await mark({id:latest.items[0].id})).body.changed).toBe(0);
    expect((await requestTestApp(app,'PATCH',comments+'/'+comment.body.id,B,{body:'Edited text'})).status).toBe(200);
    expect((await get()).body.items[0]).toMatchObject({body:'Edited text',readAt:expect.any(Number)});
    expect((await requestTestApp(app,'PUT',like,A,{liked:false})).status).toBe(200);
    expect((await get()).body.items).toHaveLength(1);
    expect((await requestTestApp(app,'PUT',like,A,{liked:true})).status).toBe(200);
    expect((await get(inbox+'?filter=unread')).body.items).toMatchObject([{kind:'like',memberName:'Alice',readAt:null}]);
    expect((await get()).body.snapshot).toBeGreaterThan(latest.snapshot);
    revokeFamilyMember(alice.member.id);
    expect((await get()).body.items[0].memberName).toBe('Alice');
    db.exec('UPDATE posts SET is_trashed=1 WHERE id=100');
    expect((await get()).body.items).toEqual([]);
    expect((await get()).body.unread).toBe(0);
    db.exec('UPDATE posts SET is_trashed=0 WHERE id=100');
    expect((await requestTestApp(app,'DELETE',comments+'/'+comment.body.id,admin)).status).toBe(200);
    expect((await get()).body.items).toHaveLength(1);
    databaseManager.close();
    expect((await get()).body.unread).toBe(1);
    expect((await mark({throughId:(await get()).body.snapshot})).body.unread).toBe(0);
    databaseManager.connection.exec('DELETE FROM posts WHERE id=100');
    expect((await get()).body.items).toEqual([]);
    expect(databaseManager.connection.prepare('SELECT COUNT(*) AS n FROM family_activity').get()).toMatchObject({n:0});
  });
});