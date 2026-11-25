import express from 'express';
import { z } from 'zod';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { authService } from '../services/auth-service.js';
import { externalFamilyOrigin, isExternalFamilyRequest } from '../middleware/external-family-access.js';
import { requireCapability } from '../middleware/auth-protection.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import {
  listFamilyPasskeys, removeFamilyPasskey, startFamilyPasskeyRegistration, finishFamilyPasskeyRegistration,
  startFamilyPasskeyAuthentication, finishFamilyPasskeyAuthentication
} from '../services/family-passkeys.js';

export const familyPasskeysRouter = express.Router();
const startLimit = createRateLimiter({ windowMs: 60000, max: 10, message: 'Too many passkey attempts. Try again shortly.' });
const finishLimit = createRateLimiter({ windowMs: 60000, max: 10, message: 'Too many passkey attempts. Try again shortly.' });
const encoded = z.string().min(1).max(65536).regex(/^[A-Za-z0-9_-]+$/);
const credentialBase = z.object({
  id: encoded, rawId: encoded, type: z.literal('public-key'),
  clientExtensionResults: z.record(z.unknown()), authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional()
});
const registration = credentialBase.extend({
  response: z.object({ clientDataJSON: encoded, attestationObject: encoded }).passthrough()
}).passthrough();
const authentication = credentialBase.extend({
  response: z.object({ clientDataJSON: encoded, authenticatorData: encoded,
    signature: encoded, userHandle: encoded }).passthrough()
}).passthrough();
const empty = z.object({}).strict();
function externalContext(request: express.Request, response: express.Response) {
  authService.setNoStoreHeaders(response);
  const origin = externalFamilyOrigin();
  const generation = authService.getFamilyGeneration();
  if (!origin || !generation || !isExternalFamilyRequest(request) ||
      request.get('host')?.toLowerCase() !== new URL(origin).host.toLowerCase() ||
      request.get('x-foldergram-external') !== '1' || request.get('x-forwarded-proto') !== 'https') {
    response.status(403).json({ message: 'Private family gallery required.' }); return null;
  }
  return { origin, generation };
}
function memberContext(request: express.Request, response: express.Response) {
  const ctx = externalContext(request, response);
  if (!ctx) return null;
  const session = authService.getFamilyPushSession(request);
  if (!session) { response.status(403).json({ message: 'Active family session required.' }); return null; }
  return { ...ctx, session };
}
function anonymousContext(request: express.Request, response: express.Response) {
  const ctx = externalContext(request, response);
  if (!ctx) return null;
  if (authService.isAuthenticatedRequest(request)) {
    response.status(409).json({ message: 'Sign out before using another sign-in method.' }); return null;
  }
  return ctx;
}
const failure = (response: express.Response) => response.status(400).json({ message: 'Passkey verification failed. Try again or use an invitation.' });

familyPasskeysRouter.get('/family/passkeys', (request, response) => {
  const ctx = memberContext(request, response); if (!ctx) return;
  return response.json({ items: listFamilyPasskeys(ctx.session.memberId, ctx.generation, ctx.origin) });
});
familyPasskeysRouter.delete('/family/passkeys/:id', (request, response) => {
  const ctx = memberContext(request, response); if (!ctx) return;
  const removed = removeFamilyPasskey(ctx.session.memberId, ctx.generation, ctx.origin, z.string().uuid().parse(request.params.id));
  return removed ? response.json({ ok: true }) : response.status(404).json({ message: 'Passkey not found.' });
});
familyPasskeysRouter.post('/family/passkeys/register/options', startLimit, async (request, response) => {
  const ctx = memberContext(request, response); if (!ctx) return;
  empty.parse(request.body);
  try { return response.json(await startFamilyPasskeyRegistration(request, response, ctx.session, ctx.origin)); }
  catch { return failure(response); }
});
familyPasskeysRouter.post('/family/passkeys/register/verify', finishLimit, async (request, response) => {
  const ctx = memberContext(request, response); if (!ctx) return;
  const credential = registration.parse(request.body) as unknown as RegistrationResponseJSON;
  try {
    const verified = await finishFamilyPasskeyRegistration(request, response, ctx.session, ctx.origin, credential);
    return verified ? response.json({ ok: true }) : failure(response);
  } catch { return failure(response); }
});
familyPasskeysRouter.post('/auth/family-passkey/options', startLimit, async (request, response) => {
  const ctx = anonymousContext(request, response); if (!ctx) return;
  empty.parse(request.body);
  try { return response.json(await startFamilyPasskeyAuthentication(request, response, ctx.generation, ctx.origin)); }
  catch { return failure(response); }
});
familyPasskeysRouter.post('/auth/family-passkey/verify', finishLimit, async (request, response) => {
  const ctx = anonymousContext(request, response); if (!ctx) return;
  const credential = authentication.parse(request.body) as unknown as AuthenticationResponseJSON;
  try {
    const identity = await finishFamilyPasskeyAuthentication(request, response, ctx.generation, ctx.origin, credential);
    if (!identity) return failure(response);
    authService.setAuthenticatedSession(response, request, 'viewer', identity);
    return response.json({ ok: true, auth: authService.getFamilyStatus(identity) });
  } catch { return failure(response); }
});

const admin = requireCapability('canAccessSettings', 'Admin access is required.');
familyPasskeysRouter.get('/admin/family/:memberId/passkeys', admin, (request, response) => {
  authService.setNoStoreHeaders(response);
  const generation = authService.getFamilyGeneration(), origin = externalFamilyOrigin();
  if (!generation || !origin) return response.status(403).json({ message: 'Private family gallery required.' });
  return response.json({ items: listFamilyPasskeys(z.string().uuid().parse(request.params.memberId), generation, origin) });
});
familyPasskeysRouter.delete('/admin/family/:memberId/passkeys/:id', admin, (request, response) => {
  authService.setNoStoreHeaders(response);
  const generation = authService.getFamilyGeneration(), origin = externalFamilyOrigin();
  if (!generation || !origin) return response.status(403).json({ message: 'Private family gallery required.' });
  const removed = removeFamilyPasskey(z.string().uuid().parse(request.params.memberId), generation, origin, z.string().uuid().parse(request.params.id));
  return removed ? response.json({ ok: true }) : response.status(404).json({ message: 'Passkey not found.' });
});
