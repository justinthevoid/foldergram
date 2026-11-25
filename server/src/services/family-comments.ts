import { databaseManager } from '../db/database.js';
import { getBranding } from './branding-service.js';

export interface CommentActor {
  key: string;
  name: string;
  owner: boolean;
}
interface CommentRow {
  id: number;
  post_id: number;
  author_key: string;
  author_name: string;
  body: string;
  created_at: number;
  updated_at: number | null;
}
const columns = 'id, post_id, author_key, author_name, body, created_at, updated_at';
const db = () => databaseManager.connection;
function present(row: CommentRow, actor: CommentActor, ownerName = getBranding().photographer) {
  const mine = row.author_key === actor.key;
  const isOwner = row.author_key === 'admin';
  return {
    id: row.id, body: row.body,
    authorName: isOwner ? ownerName : row.author_name,
    isOwner, createdAt: row.created_at, updatedAt: row.updated_at,
    canEdit: mine, canDelete: mine || actor.owner
  };
}

function get(postId: number, id: number): CommentRow | undefined {
  return db().prepare('SELECT ' + columns + ' FROM family_comments WHERE post_id = ? AND id = ?')
    .get(postId, id) as CommentRow | undefined;
}

export const familyComments = {
  list(postId: number, actor: CommentActor, beforeId?: number, limit = 20) {
    const rows = (beforeId === undefined
      ? db().prepare('SELECT ' + columns + ' FROM family_comments WHERE post_id = ? ORDER BY id DESC LIMIT ?').all(postId, limit + 1)
      : db().prepare('SELECT ' + columns + ' FROM family_comments WHERE post_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(postId, beforeId, limit + 1)) as unknown as CommentRow[];
    const page = rows.slice(0, limit);
    const ownerName = getBranding().photographer;
    return {
      items: page.map(row => present(row, actor, ownerName)),
      nextBeforeId: rows.length > limit ? page[page.length - 1]!.id : null
    };
  },

  create(postId: number, actor: CommentActor, body: string) {
    const result = db().prepare('INSERT INTO family_comments (post_id, author_key, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(postId, actor.key, actor.name, body, Date.now());
    return present(get(postId, Number(result.lastInsertRowid))!, actor);
  },

  update(postId: number, id: number, actor: CommentActor, body: string) {
    const row = get(postId, id);
    if (!row) return { status: 'missing' } as const;
    if (row.author_key !== actor.key) return { status: 'forbidden' } as const;
    db().prepare('UPDATE family_comments SET body = ?, updated_at = ? WHERE post_id = ? AND id = ? AND author_key = ?')
      .run(body, Date.now(), postId, id, actor.key);
    return { status: 'ok', comment: present(get(postId, id)!, actor) } as const;
  },

  remove(postId: number, id: number, actor: CommentActor) {
    const row = get(postId, id);
    if (!row) return 'missing';
    if (!actor.owner && row.author_key !== actor.key) return 'forbidden';
    db().prepare('DELETE FROM family_comments WHERE post_id = ? AND id = ?').run(postId, id);
    return 'ok';
  }
};