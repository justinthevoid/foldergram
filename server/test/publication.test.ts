import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('publishing visibility', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-publishing-'));
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

  it('keeps drafts private on detail, feed, media and share routes, then releases them at the specified time', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { databaseManager } = await import('../src/db/database.js');
    const { createFamilyMember } = await import('../src/services/family-service.js');
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    const db=databaseManager.connection;
    const source=db.prepare("SELECT id FROM media_sources WHERE kind='local' LIMIT 1").get() as {id:number};
    db.prepare("INSERT INTO folders(id,slug,name,folder_path,source_id) VALUES(100,'fixture','Fixture','fixture',?)").run(source.id);
    await fs.mkdir(path.join(tempRoot,'gallery','fixture'),{recursive:true});
    await fs.mkdir(path.join(tempRoot,'thumbnails','fixture'),{recursive:true});
    await fs.mkdir(path.join(tempRoot,'previews','fixture'),{recursive:true});
    const sharp=(await import('sharp')).default;
    const bytes=await sharp({create:{width:80,height:60,channels:3,background:'#778899'}}).jpeg().toBuffer();
    for(const id of [100,101]){
      const name=id+'.jpg', rel='fixture/'+name;
      await fs.writeFile(path.join(tempRoot,'gallery',rel),bytes);
      await fs.writeFile(path.join(tempRoot,'thumbnails',rel),bytes);
      await fs.writeFile(path.join(tempRoot,'previews',rel),bytes);
      db.prepare(`
        INSERT INTO images(id,folder_id,filename,extension,relative_path,source_id,absolute_path,file_size,width,height,mime_type,checksum_or_fingerprint,mtime_ms,first_seen_at,sort_timestamp,taken_at,thumbnail_path,preview_path)
        VALUES(?,100,?,'.jpg',?,?,?,100,80,60,'image/jpeg','fixture',1,'2025-01-01',?,?,?,?)
      `).run(id,name,rel,source.id,path.join(tempRoot,'gallery',rel),id,id,rel,rel);
      db.prepare("INSERT INTO posts(id,folder_id,source_path,source_id,sort_timestamp,taken_at,caption) VALUES(?,100,?,?,?,?,?)").run(id,rel,source.id,id,id,'caption-'+id);
      db.prepare("INSERT INTO post_items(post_id,image_id,position) VALUES(?,?,1)").run(id,id);
    }
    authService.setAdminPassword('fixture-admin-password');
    const app=createApp(), intent={'x-foldergram-intent':'1'};
    const cookie=(res:Awaited<ReturnType<typeof requestTestApp>>)=>({...intent,Cookie:res.headers.get('set-cookie')!.split(';',1)[0]!});
    const admin=cookie(await requestTestApp(app,'POST','/api/auth/login',intent,{password:'fixture-admin-password'}));
    const member=createFamilyMember('Viewer',authService.getFamilyGeneration()!);
    const family=cookie(await requestTestApp(app,'POST','/api/auth/family-invite',intent,{token:member.token}));
    const api='/api/admin/publications';
    const get=(url:string,headers=family)=>requestTestApp(app,'GET',url,headers);
    const change=(body:unknown,headers=admin)=>requestTestApp(app,'POST',api,headers,body);
    const ids=async(headers=family)=>{
      const r=await get('/api/feed?limit=20&mode=recent',headers);
      expect(r.status).toBe(200);
      return r.body.items.map((i:{id:number})=>i.id);
    };
    expect(await ids()).toEqual([101,100]);
    expect((await get(api,admin)).body.items.map((p:{state:string})=>p.state)).toEqual(['published','published']);
    expect((await get(api)).status).toBe(403);
    expect((await change({ids:[100],action:'draft'},family)).status).toBe(403);
    expect((await change({ids:[100,999],action:'draft'})).status).toBe(400);
    expect(await ids()).toEqual([101,100]);
    expect((await get('/thumbnails/fixture/100.jpg')).status).toBe(200);
    expect((await requestTestApp(app,'PUT','/api/family/posts/100/like',family,{liked:true})).status).toBe(200);
    const link=folderShareService.createLink('fixture',{expiresAt:null})!;
    expect(link).toBeTruthy();
    expect((await change({ids:[100],action:'draft'})).body.changed).toBe(1);
    expect(await ids()).toEqual([101]);
    expect(await ids(admin)).toEqual([101,100]);
    expect((await get(api+'?filter=draft',admin)).body.items).toMatchObject([{id:100,state:'draft',takenAt:100,publishedAt:null}]);
    for(const url of ['/api/posts/100','/api/images/100','/api/originals/100','/thumbnails/fixture/100.jpg','/previews/fixture/100.jpg','/api/family/posts/100/comments','/api/share/posts/100','/api/share/images/100/thumbnail','/api/share/images/100/preview']){
      expect((await get(url)).status,url).toBe(404);
    }
    expect((await get('/api/share/posts/100',admin)).status).toBe(404);
    expect((await get('/api/posts/100',admin)).status).toBe(200);
    expect((await get('/thumbnails/fixture/100.jpg',admin)).status).toBe(200);
    expect((await get('/api/family/likes')).body.items).toEqual([]);
    expect((await requestTestApp(app,'PUT','/api/family/posts/100/like',family,{liked:true})).status).toBe(404);
    const album=await get('/api/folders/fixture/images?limit=20');
    expect(album.status).toBe(200);
    expect(album.body.items.map((i:{id:number})=>i.id)).toEqual([101]);
    expect((await change({ids:[100],action:'feature'})).status).toBe(400);
    const release=Date.now()+60000;
    expect((await change({ids:[100],action:'schedule',publishAt:release})).status).toBe(200);
    expect((await get(api+'?filter=scheduled',admin)).body.items).toMatchObject([{id:100,state:'scheduled',publishedAt:release}]);
    expect(await ids()).toEqual([101]);
    const clock=vi.spyOn(Date,'now').mockReturnValue(release+1);
    try{
      expect(await ids()).toEqual([100,101]);
      expect((await get('/api/posts/100')).status).toBe(200);
      expect((await get('/thumbnails/fixture/100.jpg')).status).toBe(200);
      expect((await get('/api/family/likes')).body.items.map((i:{id:number})=>i.id)).toEqual([100]);
    }finally{clock.mockRestore();}
    expect((await change({folder:'fixture',action:'publish'})).body.changed).toBe(2);
    expect((await change({ids:[100],action:'feature'})).status).toBe(200);
    expect(await ids()).toEqual([100,101]);
    expect((await get(api+'?filter=featured',admin)).body.items).toMatchObject([{id:100,featured:true,takenAt:100}]);
    expect((await change({ids:[100],action:'unfeature'})).status).toBe(200);
    expect(await ids()).toEqual([101,100]);
    expect((await change({ids:[101],action:'draft'})).status).toBe(200);
    databaseManager.close();
    expect(await ids()).toEqual([100]);
    expect((await get(api+'?filter=draft',admin)).body.items).toMatchObject([{id:101,state:'draft'}]);
    const parallel=await Promise.all([ids(),ids(admin),ids(),ids(admin)]);
    expect(parallel).toEqual([[100],[100,101],[100],[100,101]]);

    const policy=api+'/import-policy';
    const setPolicy=(defaultDraft:boolean,headers=admin)=>requestTestApp(app,'PUT',policy,headers,{folder:'fixture',defaultDraft});
    expect((await setPolicy(true,family)).status).toBe(403);
    expect((await requestTestApp(app,'PUT',policy,intent,{folder:'fixture',defaultDraft:true})).status).toBe(401);
    expect((await requestTestApp(app,'PUT',policy,admin,{folder:'missing',defaultDraft:true})).status).toBe(400);
    expect((await setPolicy(true)).body).toEqual({folder:'fixture',defaultDraft:true});
    expect((await get(api,admin)).body.folders).toContainEqual({slug:'fixture',name:'Fixture',defaultDraft:true});
    expect(await ids()).toEqual([100]);
    const insert=(id:number)=>{
      const rel='fixture/'+id+'.jpg';
      const conn=databaseManager.connection;
      conn.prepare(`
        INSERT INTO images(id,folder_id,filename,extension,relative_path,source_id,absolute_path,file_size,width,height,mime_type,checksum_or_fingerprint,mtime_ms,first_seen_at,sort_timestamp,taken_at,thumbnail_path,preview_path)
        VALUES(?,100,?,'.jpg',?,?,?,100,80,60,'image/jpeg','fixture',1,'2025-01-01',?,?,?,?)
      `).run(id,id+'.jpg',rel,source.id,path.join(tempRoot,'gallery',rel),id,id,rel,rel);
      conn.prepare("INSERT INTO posts(id,folder_id,source_path,source_id,sort_timestamp,taken_at) VALUES(?,100,?,?,?,?)").run(id,rel,source.id,id,id);
      conn.prepare("INSERT INTO post_items(post_id,image_id,position) VALUES(?,?,1)").run(id,id);
    };
    insert(102);
    expect(await ids()).toEqual([100]);
    expect((await get(api+'?filter=draft',admin)).body.items.map((p:{id:number})=>p.id).sort()).toEqual([101,102]);
    expect((await change({ids:[102],action:'publish'})).status).toBe(200);
    databaseManager.connection.prepare('UPDATE posts SET updated_at=CURRENT_TIMESTAMP WHERE id=102').run();
    expect(await ids()).toEqual([102,100]);
    expect((await setPolicy(false)).body.defaultDraft).toBe(false);
    insert(103);
    expect((await ids()).sort()).toEqual([100,102,103]);
    expect((await get(api+'?filter=draft',admin)).body.items).toMatchObject([{id:101,state:'draft'}]);
    expect((await get(api,admin)).body.folders).toContainEqual({slug:'fixture',name:'Fixture',defaultDraft:false});
  });
});