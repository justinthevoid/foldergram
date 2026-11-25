import express from 'express';
import { z } from 'zod';
import { authService } from '../services/auth-service.js';
import { familyReactionRepository } from '../db/repositories.js';
import { familyComments, type CommentActor } from '../services/family-comments.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export const familyCommentsRouter = express.Router();
const route = '/family/posts/:id/comments';
const postId = z.coerce.number().int().positive().safe();
const params = z.object({ id: postId, commentId: postId.optional() });
const page = z.object({ beforeId: postId.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const body = z.object({ body: z.string().trim().min(1).max(1000) }).strict();
const writeLimit = createRateLimiter({ windowMs: 60000, max: 30, message: 'Too many comment changes. Please try again shortly.' });

function context(request: express.Request, response: express.Response): { id: number; commentId?: number; actor: CommentActor } | null {
  const auth = authService.getRequestAuthContext(request);
  if (!authService.getFamilyGeneration() || !auth.authenticated || (auth.role !== 'admin' && !auth.familyMember)) {
    response.status(403).json({ message: 'Private named family access required.' });
    return null;
  }
  const ids = params.parse(request.params);
  if (!familyReactionRepository.visiblePost(ids.id)) {
    response.status(404).json({ message: 'Post not found.' });
    return null;
  }
  const actor = auth.role === 'admin'
    ? { key: 'admin', name: '', owner: true }
    : { key: auth.familyMember!.id, name: auth.familyMember!.name, owner: false };
  return { ...ids, actor };
}

familyCommentsRouter.get(route, (request, response) => {
  const ctx = context(request, response);
  if (!ctx) return;
  const query = page.parse(request.query);
  response.json(familyComments.list(ctx.id, ctx.actor, query.beforeId, query.limit));
});

familyCommentsRouter.post(route, writeLimit, (request, response) => {
  const ctx = context(request, response);
  if (!ctx) return;
  response.status(201).json(familyComments.create(ctx.id, ctx.actor, body.parse(request.body).body));
});

familyCommentsRouter.patch(route + '/:commentId', writeLimit, (request, response) => {
  const ctx = context(request, response);
  if (!ctx) return;
  const result = familyComments.update(ctx.id, ctx.commentId!, ctx.actor, body.parse(request.body).body);
  if (result.status !== 'ok') {
    response.status(result.status === 'missing' ? 404 : 403).json({ message: result.status === 'missing' ? 'Comment not found.' : 'You can only edit your own comments.' });
    return;
  }
  response.json(result.comment);
});

familyCommentsRouter.delete(route + '/:commentId', writeLimit, (request, response) => {
  const ctx = context(request, response);
  if (!ctx) return;
  const result = familyComments.remove(ctx.id, ctx.commentId!, ctx.actor);
  if (result !== 'ok') {
    response.status(result === 'missing' ? 404 : 403).json({ message: result === 'missing' ? 'Comment not found.' : 'You cannot delete this comment.' });
    return;
  }
  response.json({ ok: true });
});