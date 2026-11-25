import { databaseManager } from '../db/database.js';
import { listFamilyMembers } from './family-service.js';

const db=()=>databaseManager.connection;
const from=`FROM family_activity a
 JOIN posts p ON p.id=a.post_id
 JOIN folders f ON f.id=p.folder_id
 JOIN media_sources s ON s.id=p.source_id
 JOIN post_items pi ON pi.post_id=p.id AND pi.position=1
 JOIN images i ON i.id=pi.image_id
 LEFT JOIN family_comments c ON c.id=a.comment_id
 WHERE p.is_deleted=0 AND p.is_trashed=0 AND i.is_deleted=0 AND i.is_trashed=0
 AND f.role='normal' AND s.enabled=1
 AND (s.kind='local' OR (s.status!='revoked' AND f.remote_visible=1))
 AND (a.kind='like' OR c.id IS NOT NULL)`;
interface ActivityRow {
  id:number;
  postId:number;
  kind:'like'|'comment';
  memberId:string;
  createdAt:number;
  readAt:number|null;
  authorName:string|null;
  body:string|null;
  filename:string;
  folderName:string;
  thumbnailPath:string;
}
function present(row:ActivityRow,names:Map<string,string>){
 const {thumbnailPath,memberId,authorName,...rest}=row;
 const remote=/^immich\/(\d+)\/assets\/([a-zA-Z0-9-]+)\/thumbnail$/.exec(thumbnailPath);
 return {...rest,memberName:names.get(memberId)??authorName,thumbnailUrl:remote?'/api/remote-media/'+remote[1]+'/'+remote[2]+'/thumbnail':'/thumbnails/'+thumbnailPath.split('/').map(encodeURIComponent).join('/')};
}
export const familyActivity={
 list(limit:number,beforeId?:number,unreadOnly=false){
  const conn=db();
  const filter=unreadOnly?' AND a.read_at IS NULL':'';
  const args=beforeId===undefined?[]:[beforeId];
  const rows=conn.prepare(`SELECT a.id,a.post_id AS postId,a.kind,a.member_id AS memberId,a.created_at AS createdAt,
    a.read_at AS readAt,c.author_name AS authorName,c.body,i.filename,f.name AS folderName,i.thumbnail_path AS thumbnailPath
    ${from}${filter}${beforeId===undefined?'':' AND a.id < ?'} ORDER BY a.id DESC LIMIT ?`)
    .all(...args,limit+1) as unknown as ActivityRow[];
  const unread=(conn.prepare('SELECT COUNT(*) AS n '+from+' AND a.read_at IS NULL').get() as {n:number}).n;
  const snapshot=(conn.prepare('SELECT COALESCE(MAX(a.id),0) AS n '+from).get() as {n:number}).n;
  const names=new Map(listFamilyMembers(null).map(m=>[m.id,m.name]));
  const items=rows.slice(0,limit).map(row=>present(row,names));
  return {items,unread,snapshot,nextBeforeId:rows.length>limit?items.at(-1)!.id:null};
 },
 read(target:{id?:number;throughId?:number}){
  const conn=db();
  const condition=target.id!==undefined?'a.id=?':'a.id<=?';
  // Only mark entries currently available to the owner. Do not acknowledge
  // future events arriving after the loaded snapshot.
  const result=conn.prepare('UPDATE family_activity SET read_at=? WHERE read_at IS NULL AND id IN (SELECT a.id '+from+' AND '+condition+')')
    .run(Date.now(),target.id??target.throughId!);
  const unread=(conn.prepare('SELECT COUNT(*) AS n '+from+' AND a.read_at IS NULL').get() as {n:number}).n;
  return {changed:Number(result.changes),unread};
 }
};