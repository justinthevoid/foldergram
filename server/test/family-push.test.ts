import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

describe.sequential('family web push', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-push-'));
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

  it('accepts only supported providers and valid browser encryption keys; sends only new visible releases to active opted-in sessions', async () => {
    const {createHash,createECDH,randomBytes}=await import('node:crypto');
    const {createApp}=await import('../src/app.js');
    const {authService}=await import('../src/services/auth-service.js');
    const {createFamilyMember,revokeFamilyMember}=await import('../src/services/family-service.js');
    const {databaseManager}=await import('../src/db/database.js');
    const {familyPush,collectNewReleases,isAllowedPushEndpoint}=await import('../src/services/family-push.js');
    const {publicationService}=await import('../src/services/publication-service.js');
    const {appSettingsRepository}=await import('../src/db/repositories.js');
    const origin='https://gallery.example.test';
    vi.stubEnv('FAMILY_INVITE_BASE_URL',origin);
    authService.setAdminPassword('fixture-admin-password');
    const app=createApp();
    const intent={'x-foldergram-intent':'1'};
    const edge={...intent,Host:'gallery.example.test',Origin:origin,'x-foldergram-external':'1','x-forwarded-proto':'https'};
    const login=await requestTestApp(app,'POST','/api/auth/login',intent,{password:'fixture-admin-password'});
    const admin={...intent,Cookie:login.headers.get('set-cookie')!.split(';',1)[0]!};
    const invite=async(name:string)=>{
      const member=createFamilyMember(name,authService.getFamilyGeneration()!);
      const joined=await requestTestApp(app,'POST','/api/auth/family-invite',edge,{token:member.token});
      expect(joined.status).toBe(200);
      return {member:member.member,headers:{...edge,Cookie:joined.headers.get('set-cookie')!.split(';',1)[0]!}};
    };
    const alice=await invite('Alice');
    const bob=await invite('Bob');
    const db=databaseManager.connection;
    const source=db.prepare("SELECT id FROM media_sources WHERE kind='local' LIMIT 1").get() as {id:number};
    db.prepare("INSERT INTO folders(id,slug,name,folder_path,source_id) VALUES(100,'fixture','Fixture','fixture',?)").run(source.id);
    const addPost=(id:number,kind:'image'|'video'='image',draft=false)=>{
      const rel='fixture/'+id+'.jpg';
      db.prepare(`
        INSERT INTO images(id,folder_id,filename,extension,relative_path,source_id,absolute_path,file_size,width,height,mime_type,media_type,checksum_or_fingerprint,mtime_ms,first_seen_at,sort_timestamp,taken_at,thumbnail_path,preview_path)
        VALUES(?,100,?,'.jpg',?,?,?,100,800,600,'image/jpeg',?,'fixture',1,'2025-01-01',?,?,?,?)
      `).run(id,id+'.jpg',rel,source.id,rel,kind,id,id,rel,rel);
      db.prepare("INSERT INTO posts(id,folder_id,source_path,source_id,sort_timestamp,taken_at) VALUES(?,100,?,?,?,?)").run(id,rel,source.id,id,id);
      db.prepare("INSERT INTO post_items(post_id,image_id,position) VALUES(?,?,1)").run(id,id);
      if(draft)db.prepare('INSERT INTO post_publications(post_id,published_at,featured,updated_at) VALUES(?,NULL,0,?)').run(id,Date.now());
    };
    addPost(100);
    expect(collectNewReleases()).toBe(1); // pre-existing photo observed before opt-in
    const push='/api/family/push';
    const get=(headers:Record<string,string>,device?:string)=>requestTestApp(app,'GET',push+(device?'?device='+device:''),headers);
    const put=(headers:Record<string,string>,body:unknown)=>requestTestApp(app,'PUT',push,headers,body);
    expect((await get(edge)).status).toBe(401);
    expect((await get(admin)).status).toBe(403);
    expect((await get({...edge,Cookie:admin.Cookie})).status).toBe(401);
    const config=await get(alice.headers);
    expect(config.status).toBe(200);
    expect(config.body).toMatchObject({publicKey:expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),enabled:false});
    expect(config.body).not.toHaveProperty('privateKey');
    expect(config.headers.get('cache-control')).toContain('no-store');
    const secret=appSettingsRepository.get('app.family-push.vapid.v1');
    expect(secret).toBeTruthy();
    expect((await get(bob.headers)).body.publicKey).toBe(config.body.publicKey);
    const subscription=(id:string)=>{
      const ecdh=createECDH('prime256v1');
      ecdh.generateKeys();
      return {endpoint:'https://fcm.googleapis.com/fcm/send/fixture-'+id,expirationTime:null,keys:{
        p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
    };
    const a=subscription('alice'),b=subscription('bob');
    const webpush=(await import('web-push')).default;
    const vapid=JSON.parse(secret!);
    const request=webpush.generateRequestDetails(a,'{"kind":"new-photos"}',{
      vapidDetails:{subject:origin,publicKey:vapid.publicKey,privateKey:vapid.privateKey},TTL:600,topic:'foldergram-new-photos'
    });
    expect(request.endpoint).toBe(a.endpoint);
    expect(request.method).toBe('POST');
    expect(request.body).toBeInstanceOf(Buffer);
    expect(request.body?.includes(Buffer.from('new-photos'))).toBe(false);
    expect(Object.keys(request.headers).map(k=>k.toLowerCase())).toContain('authorization');
    const hash=(endpoint:string)=>createHash('sha256').update(endpoint).digest('hex');
    for(const endpoint of ['http://fcm.googleapis.com/fcm/send/test','https://127.0.0.1/push','https://fcm.googleapis.com.evil.example/fcm/send/test','https://fcm.googleapis.com@evil.example/fcm/send/test','https://fcm.googleapis.com:444/fcm/send/test','https://fcm.googleapis.com/fcm/send/test?redirect=elsewhere','https://updates.push.services.mozilla.com/other','https://web.push.apple.com/short']){
      expect(isAllowedPushEndpoint(endpoint),endpoint).toBe(false);
      expect((await put(alice.headers,{...a,endpoint})).status).toBe(400);
    }
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/fixture-abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/fixture-abcdefghijklmnop')).toBe(true);
    expect((await put(alice.headers,{...a,keys:{...a.keys,p256dh:'A'.repeat(87)}})).status).toBe(400);
    expect((await put({...alice.headers,Origin:'https://other.example.test'},a)).status).toBe(403);
    expect((await put(alice.headers,a)).body).toEqual({enabled:true});
    expect((await put(alice.headers,a)).body).toEqual({enabled:true});
    expect((await put(bob.headers,a)).status).toBe(400);
    expect((await put(bob.headers,b)).status).toBe(200);
    expect((await get(alice.headers,hash(a.endpoint))).body.enabled).toBe(true);
    expect((await get(bob.headers,hash(a.endpoint))).body.enabled).toBe(false);
    const send=vi.fn<typeof import('web-push').sendNotification>(async()=>({statusCode:201,body:'',headers:{}}));
    await familyPush.tick(send);
    expect(send).not.toHaveBeenCalled();
    addPost(101,'image',true);
    addPost(102,'video');
    await familyPush.tick(send);
    expect(send).not.toHaveBeenCalled();
    addPost(103);addPost(104);
    await familyPush.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
    for(const call of send.mock.calls as unknown as Array<[unknown,string,{TTL:number;vapidDetails:{subject:string}}]>){
      expect(call[1]).toBe('{"kind":"new-photos"}');
      expect(call[2].TTL).toBe(600);
      expect(call[2].vapidDetails.subject).toBe(origin);
    }
    await familyPush.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
    // A scheduled draft must not notify until its release.
    const release=Date.now()+60000;
    publicationService.apply({ids:[101]},'schedule',release);
    await familyPush.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
    const clock=vi.spyOn(Date,'now').mockReturnValue(release+1);
    try{
      await familyPush.tick(send);
      expect(send).toHaveBeenCalledTimes(4);
      await familyPush.tick(send);
      expect(send).toHaveBeenCalledTimes(4);
    }finally{clock.mockRestore();}
    revokeFamilyMember(alice.member.id);
    addPost(105);
    await familyPush.tick(send);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({endpoint:b.endpoint});
    expect((await get(alice.headers)).status).toBe(401);
    expect((await requestTestApp(app,'POST','/api/auth/logout',bob.headers)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM family_push_subscriptions').get()).toMatchObject({n:0});
    expect((await put(bob.headers,b)).status).toBe(401);
    addPost(106);
    await familyPush.tick(send);
    expect(send).toHaveBeenCalledTimes(5);
    const carol=await invite('Carol');
    const c=subscription('carol');
    expect((await put(carol.headers,c)).status).toBe(200);
    addPost(107);
    send.mockRejectedValueOnce({statusCode:410});
    await familyPush.tick(send);
    expect(db.prepare('SELECT COUNT(*) AS n FROM family_push_subscriptions').get()).toMatchObject({n:0});
    expect((await get(carol.headers,hash(c.endpoint))).body.enabled).toBe(false);
    expect((await put(carol.headers,c)).status).toBe(200);
    expect((await requestTestApp(app,'DELETE',push+'?device='+hash(c.endpoint),carol.headers)).body).toEqual({enabled:false});
    expect(db.prepare('SELECT COUNT(*) AS n FROM family_push_subscriptions').get()).toMatchObject({n:0});
  });
});