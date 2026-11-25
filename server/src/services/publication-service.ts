import { databaseManager } from '../db/database.js';
import { galleryService } from './gallery-service.js';

export type PublicationAction = 'draft' | 'publish' | 'schedule' | 'feature' | 'unfeature';
export type PublicationFilter = 'all' | 'draft' | 'scheduled' | 'published' | 'featured';
interface ReleaseRow {
  id: number;
  filename: string;
  folderSlug: string;
  folderName: string;
  takenAt: number | null;
  sortTimestamp: number;
  caption: string | null;
  thumbnailPath: string;
  publishedAt: number | null;
  hasRelease: number;
  featured: number;
}
const db = () => databaseManager.connection;
const eligible = `posts.is_deleted=0 AND posts.is_trashed=0 AND folders.role='normal'
  AND EXISTS(SELECT 1 FROM media_sources WHERE media_sources.id=folders.source_id AND enabled=1
    AND (kind='local' OR (status!='revoked' AND folders.remote_visible=1)))
  AND NOT EXISTS(SELECT 1 FROM post_items c JOIN images cover ON cover.id=c.image_id
    JOIN media_sources s ON s.id=cover.source_id WHERE c.post_id=posts.id AND c.position=1
    AND s.kind='local' AND cover.folder_id=posts.folder_id
    AND LOWER(cover.filename) IN ('cover.jpg','cover.jpeg','cover.png','cover.webp','cover.avif','cover.gif'))`;
const from = `FROM posts JOIN folders ON folders.id=posts.folder_id
 JOIN post_items pi ON pi.post_id=posts.id AND pi.position=1
 JOIN images ON images.id=pi.image_id LEFT JOIN post_publications release ON release.post_id=posts.id`;
const fields = `posts.id, images.filename, folders.slug AS folderSlug, folders.name AS folderName,
 posts.taken_at AS takenAt, posts.sort_timestamp AS sortTimestamp, posts.caption,
 images.thumbnail_path AS thumbnailPath, release.published_at AS publishedAt,
 CASE WHEN release.post_id IS NULL THEN 0 ELSE 1 END AS hasRelease, COALESCE(release.featured,0) AS featured`;
const byFolder = `posts.id IN (
 SELECT p.id FROM posts p JOIN folders f ON f.id=p.folder_id WHERE f.slug=?
 UNION SELECT item.post_id FROM folder_media_memberships m JOIN folders f ON f.id=m.folder_id
 JOIN post_items item ON item.image_id=m.image_id WHERE f.slug=?
)`;

function present(row: ReleaseRow, now: number) {
  const state = !row.hasRelease ? 'published' : row.publishedAt === null ? 'draft' : row.publishedAt > now ? 'scheduled' : 'published';
  const { thumbnailPath, hasRelease, featured, ...rest } = row;
  const remote = /^immich\/(\d+)\/assets\/([a-zA-Z0-9-]+)\/thumbnail$/.exec(thumbnailPath);
  const thumbnailUrl = remote
    ? '/api/remote-media/' + remote[1] + '/' + remote[2] + '/thumbnail'
    : '/thumbnails/' + thumbnailPath.split('/').map(encodeURIComponent).join('/');
  return { ...rest, state, thumbnailUrl, featured: state === 'published' && Boolean(featured) };
}
function filterSql(filter: PublicationFilter) {
  if (filter === 'draft') return 'release.post_id IS NOT NULL AND release.published_at IS NULL';
  if (filter === 'scheduled') return 'release.published_at > publication_now()';
  if (filter === 'published') return '(release.post_id IS NULL OR release.published_at <= publication_now())';
  if (filter === 'featured') return 'release.featured=1 AND release.published_at <= publication_now()';
  return '1=1';
}

export const publicationService = {
  list(page: number, limit: number, filter: PublicationFilter, folder?: string) {
    const now = Date.now();
    const where = eligible + ' AND (' + filterSql(filter) + ')' + (folder ? ' AND ' + byFolder : '');
    const args = folder ? [folder, folder] : [];
    const total = (db().prepare('SELECT COUNT(*) AS count ' + from + ' WHERE ' + where).get(...args) as {count:number}).count;
    const rows = db().prepare('SELECT ' + fields + ' ' + from + ' WHERE ' + where +
      ' ORDER BY COALESCE(release.published_at,posts.taken_at,posts.sort_timestamp) DESC,posts.id DESC LIMIT ? OFFSET ?')
      .all(...args,limit,(page-1)*limit) as unknown as ReleaseRow[];
    const folders = galleryService.listFolders().map(f => ({slug:f.slug,name:f.name}));
    return { page, limit, total, items: rows.map(r=>present(r,now)), folders, hasMore:page*limit<total };
  },

  apply(target: {ids?: number[]; folder?:string}, action: PublicationAction, publishAt?: number) {
    const now = Date.now();
    if (action === 'schedule' && (publishAt === undefined || !Number.isSafeInteger(publishAt) || publishAt <= now || publishAt > now + 366*86400000)) {
      throw new Error('Choose a future release date within the next year.');
    }
    const conn = db();
    conn.exec('BEGIN IMMEDIATE');
    try {
      const ids = target.ids ? [...new Set(target.ids)] : null;
      if (target.folder && !conn.prepare('SELECT 1 FROM folders WHERE slug=?').get(target.folder)) throw new Error('Album not found.');
      const where = ids ? 'posts.id IN (' + ids.map(()=>'?').join(',') + ')' : byFolder;
      const params = ids ?? [target.folder!,target.folder!];
      const rows = conn.prepare('SELECT ' + fields + ' ' + from + ' WHERE ' + eligible + ' AND ' + where).all(...params) as unknown as ReleaseRow[];
      if (ids && rows.length !== ids.length) throw new Error('One or more selected posts are no longer available.');
      if (rows.length > 10000) throw new Error('Select a smaller album.');
      // The same indexed image may appear in multiple albums through a single
      // post. Refuse a hidden release when distinct posts share its image;
      // otherwise another post could unintentionally expose the asset.
      if (action === 'draft' || action === 'schedule') {
        const overlap = conn.prepare(`SELECT 1 FROM post_items a JOIN post_items b ON b.image_id=a.image_id AND b.post_id<>a.post_id
          JOIN posts p ON p.id=b.post_id WHERE a.post_id=? AND p.is_deleted=0 AND p.is_trashed=0 LIMIT 1`);
        if (rows.some(row=>Boolean(overlap.get(row.id)))) throw new Error('A selected photograph belongs to multiple distinct posts. Separate those posts before withholding it.');
      }
      if (action === 'feature' && rows.some(row=>row.hasRelease && (row.publishedAt === null || row.publishedAt>now))) {
        throw new Error('Only published posts can be featured.');
      }
      const upsert = conn.prepare(`INSERT INTO post_publications(post_id,published_at,featured,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(post_id) DO UPDATE SET published_at=excluded.published_at,featured=excluded.featured,updated_at=excluded.updated_at`);
      let changed=0;
      for(const row of rows) {
        const previousAt = row.hasRelease ? row.publishedAt : Math.max(1,row.takenAt ?? row.sortTimestamp ?? now);
        let date = previousAt;
        let featured = row.featured;
        if(action==='draft'){date=null;featured=0;}
        if(action==='schedule'){date=publishAt!;featured=0;}
        if(action==='publish'){date=now;}
        if(action==='feature'){featured=1;}
        if(action==='unfeature'){if(!row.hasRelease)continue;featured=0;}
        upsert.run(row.id,date,featured,now);changed++;
      }
      conn.exec('COMMIT');
      return {changed};
    } catch(error) {
      conn.exec('ROLLBACK');throw error;
    }
  }
};