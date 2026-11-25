import type express from 'express';
import { authService } from '../services/auth-service.js';
import { isPlaybackSessionMutation } from '../utils/playback-session-request.js';

// The separate tunnel connector validates Cloudflare Access before reaching the
// family proxy. That proxy overwrites this header and Host; neither is a grant
// of authentication. This middleware only restricts access further.
export function externalFamilyOrigin(): string | null {
  try {
    const url = new URL(process.env.FAMILY_INVITE_BASE_URL ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function isExternalFamilyRequest(request: express.Request): boolean {
  const origin = externalFamilyOrigin();
  return request.get('x-foldergram-external') !== undefined ||
    Boolean(origin && request.get('host')?.toLowerCase() === new URL(origin).host.toLowerCase());
}

const bootstrap = new Set(['/api/appearance', '/api/branding']);
const apiRead = [
  /^\/api\/(?:feed|reels|folders|places)(?:\/|$)/,
  /^\/api\/(?:status|scan-progress|sources\/status|branding\/profile|family\/likes)$/,
  /^\/api\/(?:posts|images)\/\d+$/,
  /^\/api\/family\/posts\/\d+\/comments$/,
  /^\/api\/remote-media\/\d+\/[a-zA-Z0-9-]+\/(?:thumbnail|preview)$/,
  /^\/api\/videos\/\d+\/playback(?:\/.*)?$/
];
const read = (method: string) => method === 'GET' || method === 'HEAD';

export function restrictExternalFamilyAccess(request: express.Request, response: express.Response, next: express.NextFunction): void {
  if (!isExternalFamilyRequest(request)) { next(); return; }
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vary', 'Cookie');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  const deny = (status = 403) => { response.status(status).json({ message: 'Private family access required.' }); };
  // Never serve private gallery data if protection is switched off.
  if (!externalFamilyOrigin() || !authService.getFamilyGeneration()) { deny(); return; }
  const rawPath = request.path;
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { deny(); return; }
  if (!path.startsWith('/') || path.includes('\\') || path.includes('//') ||
      /[\x00-\x1f\x7f?#%]/.test(path) || path.split('/').some(part => part === '.' || part === '..') ||
      /%(?:2f|5c|25|2e)/i.test(rawPath)) { deny(); return; }
  const method = request.method.toUpperCase();
  const auth = authService.getRequestAuthContext(request);
  const named = auth.authenticated && auth.role === 'viewer' && !!auth.familyMember;
  if (read(method) && path === '/api/auth/status') {
    response.json({ ...(named ? auth : authService.getLoggedOutStatus()), externalFamilyAccess: true });
    return;
  }
  if (read(method) && bootstrap.has(path)) { next(); return; }
  if (method === 'POST' && (path === '/api/auth/family-invite' || path === '/api/auth/logout')) {
    // A normal administrator cookie is never accepted by the external ingress.
    if (path.endsWith('family-invite') && auth.authenticated) { deny(); return; }
    next(); return;
  }
  const lower = path.toLowerCase();
  if (lower === '/api' || lower.startsWith('/api/') || /^\/(?:thumbnails|previews)(?:\/|$)/i.test(path)) {
    if (!named) { response.setHeader('x-foldergram-auth-required', '1'); deny(401); return; }
    if (read(method) && (/^\/(?:thumbnails|previews)\//.test(path) || apiRead.some(rule => rule.test(path)))) {
      next(); return;
    }
    const ownReaction = method === 'PUT' && /^\/api\/family\/posts\/\d+\/like$/.test(path);
    const comment = (method === 'POST' && /^\/api\/family\/posts\/\d+\/comments$/.test(path)) ||
      (['PATCH', 'DELETE'].includes(method) && /^\/api\/family\/posts\/\d+\/comments\/\d+$/.test(path));
    const playback = path.startsWith('/api/videos/') && isPlaybackSessionMutation(method, path.slice(4));
    if (ownReaction || comment || playback) { next(); return; }
    deny(); return;
  }
  // Only the read-only SPA and static assets may load before authentication.
  if (!read(method) || /^\/(?:settings|share|admin|trash)(?:\/|$)/i.test(path)) { deny(); return; }
  next();
}