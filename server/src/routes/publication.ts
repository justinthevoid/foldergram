import express from 'express';
import { z } from 'zod';
import { authService } from '../services/auth-service.js';
import { isExternalFamilyRequest } from '../middleware/external-family-access.js';
import { publicationService } from '../services/publication-service.js';

export const publicationRouter = express.Router();
const owner: express.RequestHandler = (request,response,next)=>{
  const auth=authService.getRequestAuthContext(request);
  if(!auth.enabled || !auth.authenticated || auth.role!=='admin' || isExternalFamilyRequest(request)){
    response.status(403).json({message:'Private administrator authentication required.'});return;
  }
  next();
};
const list=z.object({
  page:z.coerce.number().int().min(1).max(100000).default(1),
  limit:z.coerce.number().int().min(1).max(60).default(24),
  filter:z.enum(['all','draft','scheduled','published','featured']).default('all'),
  folder:z.string().min(1).max(240).optional()
}).strict();
const mutation=z.object({
  ids:z.array(z.number().int().positive().safe()).min(1).max(500).optional(),
  folder:z.string().min(1).max(240).optional(),
  action:z.enum(['draft','publish','schedule','feature','unfeature']),
  publishAt:z.number().int().positive().safe().optional()
}).strict().refine(value=>Boolean(value.ids)!==Boolean(value.folder),{message:'Choose posts or one album.'})
.refine(value=>(value.action==='schedule')===(value.publishAt!==undefined),{message:'Only scheduling takes a release date.'});
publicationRouter.get('/admin/publications',owner,(request,response)=>{
  const q=list.parse(request.query);
  response.json(publicationService.list(q.page,q.limit,q.filter,q.folder));
});
const importPolicy=z.object({folder:z.string().trim().min(1).max(240),defaultDraft:z.boolean()}).strict();
publicationRouter.put('/admin/publications/import-policy',owner,(request,response)=>{
  const value=importPolicy.parse(request.body);
  response.json(publicationService.setImportPolicy(value.folder,value.defaultDraft));
});
publicationRouter.post('/admin/publications',owner,(request,response)=>{
  const q=mutation.parse(request.body);
  response.json(publicationService.apply(q,q.action,q.publishAt));
});