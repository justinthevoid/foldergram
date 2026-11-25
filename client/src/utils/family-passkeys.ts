import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { AuthMutationResult } from '../types/api';
import { requestJson } from '../api/http';

export function supportsFamilyPasskeys() {
  return typeof window !== 'undefined' && window.isSecureContext &&
    typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

function post<T>(path: string, body: unknown, signal: AbortSignal) {
  return requestJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal });
}

export async function enrollFamilyPasskey(signal: AbortSignal) {
  const webauthn = await import('@simplewebauthn/browser');
  signal.throwIfAborted();
  const optionsJSON = await post<PublicKeyCredentialCreationOptionsJSON>('/api/family/passkeys/register/options', {}, signal);
  signal.throwIfAborted();
  const cancel = () => webauthn.WebAuthnAbortService.cancelCeremony();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const credential = await webauthn.startRegistration({ optionsJSON });
    signal.throwIfAborted();
    return await post<{ ok: boolean }>('/api/family/passkeys/register/verify', credential, signal);
  } finally { signal.removeEventListener('abort', cancel); }
}

export async function signInFamilyPasskey(signal: AbortSignal) {
  const webauthn = await import('@simplewebauthn/browser');
  signal.throwIfAborted();
  const optionsJSON = await post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/family-passkey/options', {}, signal);
  signal.throwIfAborted();
  const cancel = () => webauthn.WebAuthnAbortService.cancelCeremony();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const credential = await webauthn.startAuthentication({ optionsJSON });
    signal.throwIfAborted();
    return await post<AuthMutationResult>('/api/auth/family-passkey/verify', credential, signal);
  } finally { signal.removeEventListener('abort', cancel); }
}
