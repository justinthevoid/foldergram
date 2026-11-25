import { createHash } from 'node:crypto';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type express from 'express';

import {
  APP_DEFAULT_LOCALE_SETTING_KEY,
  AUTH_PASSWORD_HASH_SETTING_KEY,
  AUTH_PASSWORD_SALT_SETTING_KEY,
  AUTH_SESSION_SECRET_SETTING_KEY,
  AUTH_SESSION_VERSION_SETTING_KEY,
  AUTH_VIEWER_ACCESS_MODE_SETTING_KEY,
  AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY,
  AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appConfig } from '../config/env.js';
import { appSettingsRepository } from '../db/repositories.js';
import { getFamilyIdentity, isFamilySessionEnded, type FamilyIdentity } from './family-service.js';

export type AuthRole = 'admin' | 'viewer' | 'anonymous';
export type SessionRole = Exclude<AuthRole, 'anonymous'>;
export type ViewerAccessMode = 'off' | 'password' | 'public';
export type LikesMode = 'shared' | 'local' | 'family';
type SupportedLocale = 'en' | 'es' | 'zh' | 'de';

export interface AuthCapabilities {
  canManageLibrary: boolean;
  canDeleteMedia: boolean;
  canAccessSettings: boolean;
  canUseSharedLikes: boolean;
  canUseLocalFavorites: boolean;
  canUseSharedCollections: boolean;
  canUseLocalCollections: boolean;
}

interface AuthConfigSnapshot {
  enabled: boolean;
  adminPasswordHash: Buffer | null;
  adminPasswordSalt: Buffer | null;
  viewerPasswordHash: Buffer | null;
  viewerPasswordSalt: Buffer | null;
  sessionSecret: Buffer | null;
  sessionVersion: number;
  viewerAccessMode: ViewerAccessMode;
}

interface SessionPayload {
  exp: number;
  role: SessionRole;
  familyMemberId?: string;
  familySessionNonce?: string;
  sv: number;
}

export interface AuthStatus {
  enabled: boolean;
  publicDemoMode: boolean;
  authenticated: boolean;
  role: AuthRole;
  accessMode: ViewerAccessMode;
  likesMode: LikesMode;
  defaultLocale: SupportedLocale | null;
  capabilities: AuthCapabilities;
  familyMember?: FamilyIdentity;
}

export const AUTH_SESSION_COOKIE_NAME = 'foldergram_session';
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 256;
const PASSWORD_HASH_LENGTH = 64;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const FAMILY_SESSION_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
const SUPPORTED_LOCALES = ['en', 'es', 'zh', 'de'] as const;

function parseSupportedLocale(value: string | null): SupportedLocale | null {
  if (!value) {
    return null;
  }

  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as SupportedLocale) : null;
}

function getDefaultLocale(): SupportedLocale | null {
  return parseSupportedLocale(appSettingsRepository.get(APP_DEFAULT_LOCALE_SETTING_KEY));
}

function decodeBase64Url(value: string | null): Buffer | null {
  if (!value) {
    return null;
  }

  try {
    const buffer = Buffer.from(value, 'base64url');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function parseSessionVersion(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseViewerAccessMode(value: string | null): ViewerAccessMode {
  if (value === 'password' || value === 'public') {
    return value;
  }

  return 'off';
}

function createCapabilities(role: AuthRole): AuthCapabilities {
  if (role === 'admin') {
    return {
      canManageLibrary: true,
      canDeleteMedia: true,
      canAccessSettings: true,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };
  }

  if (role === 'viewer') {
    return {
      canManageLibrary: false,
      canDeleteMedia: false,
      canAccessSettings: false,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };
  }

  return {
    canManageLibrary: false,
    canDeleteMedia: false,
    canAccessSettings: false,
    canUseSharedLikes: false,
    canUseLocalFavorites: true,
    canUseSharedCollections: false,
    canUseLocalCollections: true
  };
}

function createStatus(role: AuthRole, authenticated: boolean, enabled: boolean, accessMode: ViewerAccessMode): AuthStatus {
  const capabilities = authenticated ? createCapabilities(role) : createCapabilities('anonymous');

  return {
    enabled,
    publicDemoMode: appConfig.publicDemoMode,
    authenticated,
    role,
    accessMode,
    likesMode: capabilities.canUseSharedLikes ? 'shared' : 'local',
    defaultLocale: getDefaultLocale(),
    capabilities
  };
}

function loadAuthConfig(): AuthConfigSnapshot {
  const adminPasswordHash = decodeBase64Url(appSettingsRepository.get(AUTH_PASSWORD_HASH_SETTING_KEY));
  const adminPasswordSalt = decodeBase64Url(appSettingsRepository.get(AUTH_PASSWORD_SALT_SETTING_KEY));
  const viewerPasswordHash = decodeBase64Url(appSettingsRepository.get(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY));
  const viewerPasswordSalt = decodeBase64Url(appSettingsRepository.get(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY));
  const sessionSecret = decodeBase64Url(appSettingsRepository.get(AUTH_SESSION_SECRET_SETTING_KEY));
  const sessionVersion = parseSessionVersion(appSettingsRepository.get(AUTH_SESSION_VERSION_SETTING_KEY));
  const enabled = adminPasswordHash !== null && adminPasswordSalt !== null && sessionSecret !== null && sessionVersion > 0;
  const rawViewerAccessMode = parseViewerAccessMode(appSettingsRepository.get(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY));
  const viewerAccessMode =
    enabled && rawViewerAccessMode === 'password' && viewerPasswordHash !== null && viewerPasswordSalt !== null
      ? 'password'
      : enabled && rawViewerAccessMode === 'public'
        ? 'public'
        : 'off';

  return {
    enabled,
    adminPasswordHash: enabled ? adminPasswordHash : null,
    adminPasswordSalt: enabled ? adminPasswordSalt : null,
    viewerPasswordHash: viewerAccessMode === 'password' ? viewerPasswordHash : null,
    viewerPasswordSalt: viewerAccessMode === 'password' ? viewerPasswordSalt : null,
    sessionSecret: enabled ? sessionSecret : null,
    sessionVersion: enabled ? sessionVersion : 0,
    viewerAccessMode
  };
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, PASSWORD_HASH_LENGTH);
}

function signValue(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const prefix = `${cookieName}=`;

  for (const chunk of cookieHeader.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    const rawValue = trimmed.slice(prefix.length);
    if (rawValue.length === 0) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function parseSessionToken(token: string, secret: Buffer): SessionPayload | null {
  const separatorIndex = token.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signValue(encodedPayload, secret);

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      (payload.role !== 'admin' && payload.role !== 'viewer') ||
      typeof payload.sv !== 'number' ||
      !Number.isInteger(payload.sv) ||
      payload.sv <= 0 ||
      (payload.familyMemberId !== undefined &&
        (payload.role !== 'viewer' || typeof payload.familyMemberId !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.familyMemberId)))
    ) {
      return null;
    }

    return {
      exp: payload.exp,
      role: payload.role,
      sv: payload.sv,
      ...(payload.familyMemberId ? { familyMemberId: payload.familyMemberId } : {})
    };
  } catch {
    return null;
  }
}

function isSecureRequest(request: express.Request): boolean {
  if (request.secure) {
    return true;
  }

  const forwardedProto = request.get('x-forwarded-proto');
  if (!forwardedProto) {
    return false;
  }

  const firstValue = forwardedProto
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .find((entry) => entry.length > 0);

  return firstValue === 'https' || firstValue === 'https:';
}

let authConfig = loadAuthConfig();

function getAnonymousStatus(): AuthStatus {
  return createStatus('anonymous', false, authConfig.enabled, authConfig.viewerAccessMode);
}

function createAuthenticatedStatus(role: SessionRole = 'admin'): AuthStatus {
  return createStatus(role, true, authConfig.enabled, authConfig.viewerAccessMode);
}

function storeSessionConfig(nextSessionVersion: number): void {
  const sessionSecret = randomBytes(32);
  appSettingsRepository.set(AUTH_SESSION_SECRET_SETTING_KEY, sessionSecret.toString('base64url'));
  appSettingsRepository.set(AUTH_SESSION_VERSION_SETTING_KEY, String(nextSessionVersion));
}

function getRequestSession(request: express.Request): SessionPayload | null {
  if (!authConfig.enabled || !authConfig.sessionSecret) {
    return null;
  }

  const cookieHeader = request.get('cookie') ?? undefined;
  const token = parseCookieValue(cookieHeader, AUTH_SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token, authConfig.sessionSecret);
  if (!payload) {
    return null;
  }

  if (payload.exp <= Date.now()) {
    return null;
  }

  if (payload.sv !== authConfig.sessionVersion) return null;
  // The existing persistent ended-session record also revokes gallery access.
  // Every new family cookie has its own nonce, even for simultaneous joins.
  if (payload.familyMemberId) {
    try {
      if (isFamilySessionEnded(createHash('sha256').update(token).digest('hex'))) return null;
    } catch { return null; }
  }
  return payload;
}

export const authService = {
  refresh(): void {
    authConfig = loadAuthConfig();
  },

  getViewerAccessMode(): ViewerAccessMode {
    return authConfig.viewerAccessMode;
  },

  isEnabled(): boolean {
    return authConfig.enabled;
  },

  isPublicViewerAccessEnabled(): boolean {
    return authConfig.enabled && authConfig.viewerAccessMode === 'public';
  },

  getStatus(request: express.Request): AuthStatus {
    if (!authConfig.enabled) {
      return createStatus('admin', true, false, 'off');
    }

    return this.getRequestAuthContext(request);
  },

  getLoggedOutStatus(): AuthStatus {
    return authConfig.enabled ? getAnonymousStatus() : createStatus('admin', true, false, 'off');
  },

  getFamilyGeneration(): string | null {
    return authConfig.enabled && authConfig.sessionSecret && authConfig.viewerAccessMode !== 'public'
      ? signValue('foldergram-family-invite-v1', authConfig.sessionSecret)
      : null;
  },

  getFamilyPushSession(request: express.Request) {
    const session = getRequestSession(request);
    const generation = this.getFamilyGeneration();
    const token = parseCookieValue(request.get('cookie') ?? undefined, AUTH_SESSION_COOKIE_NAME);
    if (!session?.familyMemberId || !generation || !token || !getFamilyIdentity(session.familyMemberId)) return null;
    return {memberId:session.familyMemberId, expiresAt:session.exp, generation,
      sessionKey:createHash('sha256').update(token).digest('hex')};
  },

  getFamilyStatus(identity: FamilyIdentity): AuthStatus {
    const status = createAuthenticatedStatus('viewer');
    // Named family sessions never modify the existing shared likes/collections.
    status.capabilities = {
      ...status.capabilities,
      canUseSharedLikes: false,
      canUseSharedCollections: false,
      canUseLocalFavorites: false,
      canUseLocalCollections: true
    };
    return { ...status, likesMode: 'family', familyMember: identity };
  },
  getAuthenticatedStatus(role: SessionRole = 'admin'): AuthStatus {
    return createAuthenticatedStatus(role);
  },

  getRequestAuthContext(request: express.Request): AuthStatus {
    if (!authConfig.enabled) {
      return createStatus('admin', true, false, 'off');
    }

    const session = getRequestSession(request);
    if (!session) return getAnonymousStatus();
    if (session.familyMemberId) {
      const identity = getFamilyIdentity(session.familyMemberId);
      if (!identity) return getAnonymousStatus();
      return this.getFamilyStatus(identity);
    }
    return createAuthenticatedStatus(session.role);
  },

  isAuthenticatedRequest(request: express.Request): boolean {
    return this.getRequestAuthContext(request).authenticated;
  },

  hasCapability(request: express.Request, capability: keyof AuthCapabilities): boolean {
    return this.getRequestAuthContext(request).capabilities[capability];
  },

  verifyAdminPassword(password: string): boolean {
    if (!authConfig.enabled || !authConfig.adminPasswordHash || !authConfig.adminPasswordSalt) {
      return false;
    }

    const expectedHash = hashPassword(password, authConfig.adminPasswordSalt);
    return (
      expectedHash.length === authConfig.adminPasswordHash.length &&
      timingSafeEqual(expectedHash, authConfig.adminPasswordHash)
    );
  },

  verifyViewerPassword(password: string): boolean {
    if (authConfig.viewerAccessMode !== 'password' || !authConfig.viewerPasswordHash || !authConfig.viewerPasswordSalt) {
      return false;
    }

    const expectedHash = hashPassword(password, authConfig.viewerPasswordSalt);
    return (
      expectedHash.length === authConfig.viewerPasswordHash.length &&
      timingSafeEqual(expectedHash, authConfig.viewerPasswordHash)
    );
  },

  authenticatePassword(password: string): SessionRole | null {
    if (!authConfig.enabled) {
      return null;
    }

    if (this.verifyAdminPassword(password)) {
      return 'admin';
    }

    if (this.verifyViewerPassword(password)) {
      return 'viewer';
    }

    return null;
  },

  setAdminPassword(password: string): AuthStatus {
    if (authConfig.viewerAccessMode === 'password' && this.verifyViewerPassword(password)) {
      throw new Error('Viewer password must be different from the admin password.');
    }

    const salt = randomBytes(16);
    const passwordHash = hashPassword(password, salt);
    const nextSessionVersion = Math.max(1, authConfig.sessionVersion + 1);

    appSettingsRepository.set(AUTH_PASSWORD_HASH_SETTING_KEY, passwordHash.toString('base64url'));
    appSettingsRepository.set(AUTH_PASSWORD_SALT_SETTING_KEY, salt.toString('base64url'));

    if (!authConfig.enabled) {
      appSettingsRepository.set(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY, 'off');
      appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY);
      appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY);
    }

    storeSessionConfig(nextSessionVersion);

    this.refresh();
    return createAuthenticatedStatus('admin');
  },

  setViewerAccess(mode: ViewerAccessMode, viewerPassword: string | null = null): AuthStatus {
    if (!authConfig.enabled) {
      throw new Error('Enable the admin password before configuring viewer access.');
    }

    if (mode === 'password') {
      if (!viewerPassword) {
        throw new Error('Viewer password is required when viewer access mode is password.');
      }

      if (this.verifyAdminPassword(viewerPassword)) {
        throw new Error('Viewer password must be different from the admin password.');
      }

      const viewerSalt = randomBytes(16);
      const viewerHash = hashPassword(viewerPassword, viewerSalt);
      appSettingsRepository.set(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY, viewerHash.toString('base64url'));
      appSettingsRepository.set(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY, viewerSalt.toString('base64url'));
    } else {
      appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY);
      appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY);
    }

    appSettingsRepository.set(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY, mode);
    storeSessionConfig(Math.max(1, authConfig.sessionVersion + 1));

    this.refresh();
    return createAuthenticatedStatus('admin');
  },

  disable(): AuthStatus {
    appSettingsRepository.remove(AUTH_PASSWORD_HASH_SETTING_KEY);
    appSettingsRepository.remove(AUTH_PASSWORD_SALT_SETTING_KEY);
    appSettingsRepository.remove(AUTH_SESSION_SECRET_SETTING_KEY);
    appSettingsRepository.remove(AUTH_SESSION_VERSION_SETTING_KEY);
    appSettingsRepository.remove(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY);
    appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY);
    appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY);

    this.refresh();
    return createStatus('admin', true, false, 'off');
  },

  setAuthenticatedSession(response: express.Response, request: express.Request, role: SessionRole = 'admin', familyMember?: FamilyIdentity): void {
    if (!authConfig.enabled || !authConfig.sessionSecret) {
      return;
    }

    const duration = familyMember ? FAMILY_SESSION_DURATION_MS : SESSION_DURATION_MS;
    const payload: SessionPayload = {
      exp: Date.now() + duration,
      role,
      sv: authConfig.sessionVersion,
      ...(familyMember ? { familyMemberId: familyMember.id, familySessionNonce: randomBytes(16).toString('base64url') } : {})
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signValue(encodedPayload, authConfig.sessionSecret);

    response.cookie(AUTH_SESSION_COOKIE_NAME, `${encodedPayload}.${signature}`, {
      encode: (value) => value,
      httpOnly: true,
      maxAge: duration,
      path: '/',
      sameSite: 'lax',
      secure: isSecureRequest(request)
    });
  },

  clearAuthenticatedSession(response: express.Response, request: express.Request): void {
    response.cookie(AUTH_SESSION_COOKIE_NAME, '', {
      encode: (value) => value,
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: isSecureRequest(request)
    });
  },

  setNoStoreHeaders(response: express.Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
};
