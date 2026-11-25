import type express from 'express';
import { authService } from '../services/auth-service.js';
import { withPublicationAccess } from '../db/publication-scope.js';
import { isExternalFamilyRequest } from './external-family-access.js';

export function publicationAccess(request: express.Request, _response: express.Response, next: express.NextFunction) {
  let path = '';
  try { path = decodeURIComponent(request.path).toLowerCase(); } catch { /* default to viewer */ }
  const shared = !path || path === '/api/share' || path.startsWith('/api/share/');
  const auth = authService.getRequestAuthContext(request);
  const owner = !shared && !isExternalFamilyRequest(request) && auth.enabled && auth.authenticated && auth.role === 'admin';
  return withPublicationAccess(owner, next);
}