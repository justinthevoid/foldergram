import express from 'express';
import { z } from 'zod';
import { authService } from '../services/auth-service.js';
import { externalFamilyOrigin,isExternalFamilyRequest } from '../middleware/external-family-access.js';
import { familyPush,pushSubscriptionSchema } from '../services/family-push.js';
export const familyPushRouter=express.Router();
const device=z.string().regex(/^[a-f0-9]{64}$/);
function context(request:express.Request,response:express.Response){
 const origin=externalFamilyOrigin();
 const session=authService.getFamilyPushSession(request);
 if(!origin||!isExternalFamilyRequest(request)||!session){
  response.status(403).json({message:'Active family gallery session required.'});return null;
 }
 response.setHeader('Cache-Control','private, no-store');
 return {origin,session};
}
familyPushRouter.get('/family/push',(request,response)=>{
 const ctx=context(request,response);if(!ctx)return;
 const q=z.object({device:device.optional()}).strict().parse(request.query);
 response.json(familyPush.config(ctx.session,ctx.origin,q.device));
});
familyPushRouter.put('/family/push',(request,response)=>{
 const ctx=context(request,response);if(!ctx)return;
 response.json(familyPush.subscribe(ctx.session,ctx.origin,pushSubscriptionSchema.parse(request.body)));
});
familyPushRouter.delete('/family/push',(request,response)=>{
 const ctx=context(request,response);if(!ctx)return;
 const q=z.object({device}).strict().parse(request.query);
 response.json(familyPush.unsubscribe(ctx.session,ctx.origin,q.device));
});