import { createHash, ECDH } from 'node:crypto';
import webpush from 'web-push';
import { z } from 'zod';
import { databaseManager } from '../db/database.js';
import { appSettingsRepository } from '../db/repositories.js';
import { visiblePublicationPostSql, withPublicationAccess } from '../db/publication-scope.js';
import { authService } from './auth-service.js';
import { getFamilyIdentity } from './family-service.js';
import { externalFamilyOrigin } from '../middleware/external-family-access.js';

const db=()=>databaseManager.connection;
const vapidKey='app.family-push.vapid.v1';
const keySchema=z.object({publicKey:z.string().regex(/^[A-Za-z0-9_-]{87}$/),privateKey:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
type Session=NonNullable<ReturnType<typeof authService.getFamilyPushSession>>;
const maxDevices=5;
const maxTotal=200;
const intervalMs=5*60*1000;
const ttlSeconds=600;
export function isAllowedPushEndpoint(value:string) {
 try{
  if(value.length>2048||!/^https:\/\//.test(value))return false;
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.href!==value)return false;
  if(!/^\/[A-Za-z0-9_.~:\/-]+$/.test(u.pathname))return false;
  if(u.hostname==='fcm.googleapis.com')return /^\/fcm\/send\/[A-Za-z0-9_.~:-]+$/.test(u.pathname);
  if(u.hostname==='updates.push.services.mozilla.com')return /^\/wpush\/v[12]\/[A-Za-z0-9_.~:-]+$/.test(u.pathname);
  if(u.hostname==='web.push.apple.com')return u.pathname.length>16;
  return false;
 }catch{return false;}
}
function validPublicKey(value:string){
 try{
  const bytes=Buffer.from(value,'base64url');
    if(bytes.length!==65||bytes[0]!==4)return false;
  const normalized=ECDH.convertKey(bytes,'prime256v1');
  return Buffer.isBuffer(normalized)&&normalized.equals(bytes);
 }catch{return false;}
}
export const pushSubscriptionSchema=z.object({
 endpoint:z.string().max(2048).refine(isAllowedPushEndpoint,{message:'Unsupported push provider.'}),
 keys:z.object({
  p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}$/).refine(validPublicKey,{message:'Invalid public key.'}),
  auth:z.string().regex(/^[A-Za-z0-9_-]{22}$/)
 }).strict(),
 expirationTime:z.number().finite().nullable().optional()
}).strict();
type Subscription=z.infer<typeof pushSubscriptionSchema>;
const deviceId=(endpoint:string)=>createHash('sha256').update(endpoint).digest('hex');
function keys(create=false){
 const existing=appSettingsRepository.get(vapidKey);
 if(existing)return keySchema.parse(JSON.parse(existing));
 if(!create)return null;
 const value=keySchema.parse(webpush.generateVAPIDKeys());
 appSettingsRepository.set(vapidKey,JSON.stringify(value));
 return value;
}
function currentSession(session:Session,origin:string){
 if(origin!==externalFamilyOrigin()||session.generation!==authService.getFamilyGeneration()||session.expiresAt<=Date.now()||!getFamilyIdentity(session.memberId)||db().prepare('SELECT 1 FROM family_push_ended_sessions WHERE session_key=?').get(session.sessionKey))throw new Error('Active family session required.');
}
interface Device {
 device_id:string;member_id:string;session_key:string;generation:string;origin:string;endpoint:string;p256dh:string;auth_secret:string;expires_at:number;subscribed_at:number;
}
const allDevices=()=>db().prepare('SELECT * FROM family_push_subscriptions ORDER BY subscribed_at').all() as unknown as Device[];
function active(row:Device,now=Date.now()){
 return row.expires_at>now&&row.generation===authService.getFamilyGeneration()&&row.origin===externalFamilyOrigin()&&!!getFamilyIdentity(row.member_id)&&isAllowedPushEndpoint(row.endpoint);
}
function prune(){
 const conn=db();
 conn.prepare('DELETE FROM family_push_ended_sessions WHERE expires_at<=?').run(Date.now());
 const remove=conn.prepare('DELETE FROM family_push_subscriptions WHERE device_id=?');
 for(const row of allDevices())if(!active(row))remove.run(row.device_id);
}
// Baseline old releases in the migration. After that, only new visible photos
// or explicit release dates later than the last observation count as new.
export function collectNewReleases(now=Date.now()){
 return withPublicationAccess(false,()=>{
  const conn=db();
  conn.exec('BEGIN IMMEDIATE');
  try{
   const rows=conn.prepare(`SELECT p.id FROM posts p JOIN folders f ON f.id=p.folder_id
    JOIN media_sources s ON s.id=p.source_id JOIN post_items pi ON pi.post_id=p.id AND pi.position=1
    JOIN images i ON i.id=pi.image_id LEFT JOIN post_publications release ON release.post_id=p.id
    LEFT JOIN family_release_seen seen ON seen.post_id=p.id
    WHERE p.is_deleted=0 AND p.is_trashed=0 AND i.is_deleted=0 AND i.is_trashed=0 AND i.media_type='image'
      AND f.role='normal' AND s.enabled=1 AND (s.kind='local' OR (s.status!='revoked' AND f.remote_visible=1))
      AND NOT (s.kind='local' AND i.folder_id=p.folder_id AND LOWER(i.filename) IN ('cover.jpg','cover.jpeg','cover.png','cover.webp','cover.avif','cover.gif'))
      AND ${visiblePublicationPostSql('p')}
      AND (release.post_id IS NULL OR release.published_at<=?)
      AND (seen.post_id IS NULL OR release.published_at>seen.noticed_at)
   `).all(now) as Array<{id:number}>;
   const mark=conn.prepare('INSERT INTO family_release_seen(post_id,noticed_at) VALUES(?,?) ON CONFLICT(post_id) DO UPDATE SET noticed_at=excluded.noticed_at');
   for(const row of rows)mark.run(row.id,now);
   conn.exec('COMMIT');
   return rows.length;
  }catch(error){conn.exec('ROLLBACK');throw error;}
 });
}
type Send=typeof webpush.sendNotification;
let timer:ReturnType<typeof setInterval>|undefined;
let pending:Promise<void>|null=null;
let stopping=false;
export const familyPush={
 config(session:Session,origin:string,device?:string){
  currentSession(session,origin);
  const key=keys(true)!;
  prune();
  const enabled=!!(device&&db().prepare('SELECT 1 FROM family_push_subscriptions WHERE device_id=? AND member_id=? AND session_key=?').get(device,session.memberId,session.sessionKey));
  return {publicKey:key.publicKey,enabled};
 },
 subscribe(session:Session,origin:string,input:Subscription){
  currentSession(session,origin);
  const subscription=pushSubscriptionSchema.parse(input);
  keys(true);
  const conn=db(),id=deviceId(subscription.endpoint);
  conn.exec('BEGIN IMMEDIATE');
  try{
   prune();
   const existing=conn.prepare('SELECT * FROM family_push_subscriptions WHERE device_id=?').get(id) as Device|undefined;
   if(existing&&existing.member_id!==session.memberId)throw new Error('This device belongs to a different family account. Disable notifications there first.');
   if(!existing){
    const count=(conn.prepare('SELECT COUNT(*) AS n FROM family_push_subscriptions WHERE member_id=?').get(session.memberId) as {n:number}).n;
    const total=(conn.prepare('SELECT COUNT(*) AS n FROM family_push_subscriptions').get() as {n:number}).n;
    if(count>=maxDevices||total>=maxTotal)throw new Error('Notification device limit reached.');
   }
   const expiration=Math.min(session.expiresAt,subscription.expirationTime??session.expiresAt);
   if(expiration<=Date.now())throw new Error('Notification subscription expired.');
   conn.prepare(`INSERT INTO family_push_subscriptions(device_id,member_id,session_key,generation,origin,endpoint,p256dh,auth_secret,expires_at,subscribed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET session_key=excluded.session_key,generation=excluded.generation,
    origin=excluded.origin,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,expires_at=excluded.expires_at`)
    .run(id,session.memberId,session.sessionKey,session.generation,origin,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,expiration,Date.now());
   conn.exec('COMMIT');
   return {enabled:true};
  }catch(error){conn.exec('ROLLBACK');throw error;}
 },
 unsubscribe(session:Session,origin:string,id:string){
  currentSession(session,origin);
  db().prepare('DELETE FROM family_push_subscriptions WHERE device_id=? AND member_id=?').run(id,session.memberId);
  return {enabled:false};
 },
 removeSession(session:Session){
  const conn=db();
  conn.exec('BEGIN IMMEDIATE');
  try{
   conn.prepare('INSERT INTO family_push_ended_sessions(session_key,expires_at) VALUES(?,?) ON CONFLICT(session_key) DO NOTHING').run(session.sessionKey,session.expiresAt);
   conn.prepare('DELETE FROM family_push_subscriptions WHERE session_key=?').run(session.sessionKey);
   conn.exec('COMMIT');
  }catch(error){conn.exec('ROLLBACK');throw error;}
 },
 async tick(send:Send=webpush.sendNotification){
  prune();
  const count=collectNewReleases();
  const origin=externalFamilyOrigin(),key=keys();
  if(!count||!origin||!key||!authService.getFamilyGeneration())return;
  // Coalesce all newly visible photos into a single generic alert per device.
  // Mark the batch before dispatch: restart or network errors cannot cause a
  // replay storm. Delivery is best-effort; no sensitive content is sent.
  const devices=allDevices();
  for(let offset=0;offset<devices.length&&!stopping;offset+=4){
   await Promise.allSettled(devices.slice(offset,offset+4).map(async row=>{
    const current=db().prepare('SELECT * FROM family_push_subscriptions WHERE device_id=?').get(row.device_id) as Device|undefined;
    if(!current||!active(current)||current.session_key!==row.session_key)return;
    try{
     await send({endpoint:current.endpoint,keys:{p256dh:current.p256dh,auth:current.auth_secret}},JSON.stringify({kind:'new-photos'}),{
       vapidDetails:{subject:origin,publicKey:key.publicKey,privateKey:key.privateKey},
       TTL:ttlSeconds,timeout:10000,urgency:'normal',topic:'foldergram-new-photos'
     });
    }catch(error){
     const status=(error as {statusCode?:number})?.statusCode;
     if(status===404||status===410)db().prepare('DELETE FROM family_push_subscriptions WHERE device_id=? AND session_key=?').run(row.device_id,row.session_key);
     // Never log provider errors: they can include endpoint credentials.
    }
   }));
  }
 },
 start(){
  if(timer||!externalFamilyOrigin())return;
  stopping=false;
  const run=()=>{
   if(pending||stopping)return;
   pending=this.tick().catch(()=>{/* Keep gallery available if notification delivery is unavailable. */}).finally(()=>{pending=null;});
  };
  run();timer=setInterval(run,intervalMs);timer.unref();
 },
 async stop(){stopping=true;if(timer){clearInterval(timer);timer=undefined;}await pending;}
};