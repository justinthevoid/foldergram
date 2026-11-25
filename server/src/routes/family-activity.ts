import express from 'express';
import { z } from 'zod';
import { authService } from '../services/auth-service.js';
import { isExternalFamilyRequest } from '../middleware/external-family-access.js';
import { familyActivity } from '../services/family-activity.js';

export const familyActivityRouter=express.Router();
const owner:express.RequestHandler=(request,response,next)=>{
 const auth=authService.getRequestAuthContext(request);
 if(!auth.enabled||!auth.authenticated||auth.role!=='admin'||!authService.getFamilyGeneration()||isExternalFamilyRequest(request)){
  response.status(403).json({message:'Private administrator authentication required.'});return;
 }
 authService.setNoStoreHeaders(response);
 next();
};
const id=z.coerce.number().int().positive().safe();
const list=z.object({limit:z.coerce.number().int().min(1).max(60).default(30),beforeId:id.optional(),filter:z.enum(['all','unread']).default('all')}).strict();
const read=z.union([z.object({id:z.number().int().positive().safe()}).strict(),z.object({throughId:z.number().int().nonnegative().safe()}).strict()]);
familyActivityRouter.get('/admin/activity',owner,(request,response)=>{
 const q=list.parse(request.query);
 response.json(familyActivity.list(q.limit,q.beforeId,q.filter==='unread'));
});
familyActivityRouter.post('/admin/activity/read',owner,(request,response)=>{
 response.json(familyActivity.read(read.parse(request.body)));
});