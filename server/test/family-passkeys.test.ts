import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestTestApp, type TestHttpResponse } from './http-test-utils.js';

const origin = 'https://gallery.example.test';
const rpID = 'gallery.example.test';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const cookie = (result: TestHttpResponse, name: string) => {
  const value = result.headers.getSetCookie().find(entry => entry.startsWith(name + '='));
  expect(value).toBeTruthy();
  return value!.split(';', 1)[0]!;
};

// Test-only virtual authenticator: real P-256 signatures and standard
// WebAuthn "none" attestation data; production verification is not mocked.
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const key = isoCBOR.encode(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))]
  ] as Array<[number, number | Uint8Array]>));
  const credentialId = randomBytes(32);
  const id = b64(credentialId);
  function data(type: string, challenge: string, site = origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: site, crossOrigin: false }));
  }
  function header(flags: number, counter: number) {
    const buffer = Buffer.alloc(37);
    hash(rpID).copy(buffer);
    buffer[32] = flags;
    buffer.writeUInt32BE(counter, 33);
    return buffer;
  }
  function register(challenge: string) {
    const authData = Buffer.concat([header(0x45, 0), Buffer.alloc(16), Buffer.from([0, 32]), credentialId, key]);
    const attestationObject = isoCBOR.encode(new Map<string, any>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]
    ]));
    return { id, rawId: id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64(data('webauthn.create', challenge)), attestationObject: b64(attestationObject) } };
  }
  function assert(challenge: string, handle: string, counter: number, options: { site?: string; verified?: boolean } = {}) {
    const clientData = data('webauthn.get', challenge, options.site);
    const authData = header(options.verified === false ? 0x01 : 0x05, counter);
    const signature = sign('sha256', Buffer.concat([authData, hash(clientData)]), privateKey);
    return { id, rawId: id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData),
        signature: b64(signature), userHandle: handle } };
  }
  return { register, assert };
}

describe.sequential('family passkey authentication', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-family-passkeys-'));
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) {
      const folder = path.join(tempRoot, directory);
      await fs.mkdir(folder, { recursive: true });
      vi.stubEnv(key, folder);
    }
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CSRF_TRUSTED_ORIGINS', origin);
    vi.stubEnv('FAMILY_INVITE_BASE_URL', origin);
    vi.stubEnv('PUBLIC_DEMO_MODE', '0');
    vi.resetModules();
  });
  afterAll(async () => {
    const { databaseManager } = await import('../src/db/database.js');
    databaseManager.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  it('requires invitation enrollment and verifies actual signatures, origin, user verification, challenge and identity', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { createFamilyMember, revokeFamilyMember } = await import('../src/services/family-service.js');
    const { databaseManager } = await import('../src/db/database.js');
    const app = createApp();
    const intent = { 'x-foldergram-intent': '1' };
    const edge = { ...intent, Host: rpID, Origin: origin,
      'x-foldergram-external': '1', 'x-forwarded-proto': 'https' };
    const registration = '/api/family/passkeys/register';
    const authentication = '/api/auth/family-passkey';
    const list = '/api/family/passkeys';
    const challengeName = 'foldergram_passkey_challenge';
    authService.setAdminPassword('fixture-passkey-admin-password');
    const generation = authService.getFamilyGeneration()!;
    const alice = createFamilyMember('Alice', generation);
    const bob = createFamilyMember('Bob', generation);
    const join = async (token: string) => {
      const result = await requestTestApp(app, 'POST', '/api/auth/family-invite', edge, { token });
      expect(result.status).toBe(200);
      return { ...edge, Cookie: cookie(result, 'foldergram_session') };
    };
    const phone = await join(alice.token);
    const other = await join(bob.token);
    expect((await requestTestApp(app, 'POST', registration + '/options', edge, {})).status).toBe(401);
    expect((await requestTestApp(app, 'POST', authentication + '/options', phone, {})).status).toBe(403);
    expect((await requestTestApp(app, 'POST', authentication + '/options', intent, {})).status).toBe(403);
    const options = await requestTestApp(app, 'POST', registration + '/options', phone, {});
    expect(options.status).toBe(200);
    expect(options.body.rp.id).toBe(rpID);
    expect(options.body.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    const handle = options.body.user.id;
    expect(handle).toBe(b64(Buffer.from(alice.member.id)));
    expect(options.headers.get('cache-control')).toContain('no-store');
    const challengeHeader = cookie(options, challengeName);
    expect(options.headers.get('set-cookie')).toContain('HttpOnly');
    expect(options.headers.get('set-cookie')).toContain('Secure');
    const virtual = authenticator();
    const registrationResponse = virtual.register(options.body.challenge);
    const enrollment = { ...phone, Cookie: phone.Cookie + '; ' + challengeHeader };
    const enrolled = await requestTestApp(app, 'POST', registration + '/verify', enrollment, registrationResponse);
    expect(enrolled.status).toBe(200);
    expect((await requestTestApp(app, 'POST', registration + '/verify', enrollment, registrationResponse)).status).toBe(400);
    const keys = await requestTestApp(app, 'GET', list, phone);
    expect(keys.body.items).toHaveLength(1);
    const keyId = keys.body.items[0].id;
    expect(JSON.stringify(keys.body)).not.toContain(registrationResponse.id);
    expect((await requestTestApp(app, 'GET', list, other)).body.items).toEqual([]);
    expect((await requestTestApp(app, 'DELETE', list + '/' + keyId, other)).status).toBe(404);
    const start = async () => {
      const result = await requestTestApp(app, 'POST', authentication + '/options', edge, {});
      expect(result.status).toBe(200);
      expect(result.body.userVerification).toBe('required');
      expect(result.body.allowCredentials ?? []).toEqual([]);
      return { challenge: result.body.challenge as string, headers: { ...edge, Cookie: cookie(result, challengeName) } };
    };
    const verify = (headers: Record<string, string>, credential: unknown) =>
      requestTestApp(app, 'POST', authentication + '/verify', headers, credential);

    let attempt = await start();
    expect((await verify(edge, virtual.assert(attempt.challenge, handle, 1))).status).toBe(400);
    expect((await verify(attempt.headers, virtual.assert(attempt.challenge, handle, 1, { site: 'https://wrong.example.test' }))).status).toBe(400);
    attempt = await start();
    expect((await verify(attempt.headers, virtual.assert(attempt.challenge, handle, 1, { verified: false }))).status).toBe(400);
    attempt = await start();
    expect((await verify(attempt.headers, virtual.assert(attempt.challenge, b64(Buffer.from(bob.member.id)), 1))).status).toBe(400);
    attempt = await start();
    const signed = virtual.assert(attempt.challenge, handle, 1);
    const tampered = { ...signed, response: { ...signed.response, signature: b64(randomBytes(64)) } };
    expect((await verify(attempt.headers, tampered)).status).toBe(400);
    attempt = await start();
    const assertion = virtual.assert(attempt.challenge, handle, 1);
    const signedIn = await verify(attempt.headers, assertion);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.auth).toMatchObject({ role: 'viewer', familyMember: { id: alice.member.id }, likesMode: 'family' });
    const newDevice = { ...edge, Cookie: cookie(signedIn, 'foldergram_session') };
    expect(newDevice.Cookie).not.toBe(phone.Cookie);
    expect((await requestTestApp(app, 'GET', '/api/feed', newDevice)).status).toBe(200);
    expect((await requestTestApp(app, 'GET', '/api/family/devices', newDevice)).body.items).toHaveLength(2);
    expect((await verify(attempt.headers, assertion)).status).toBe(400);
    databaseManager.close();
    expect((await requestTestApp(app, 'GET', list, newDevice)).body.items[0].lastUsedAt).toBeGreaterThan(0);
    const login = await requestTestApp(app, 'POST', '/api/auth/login', intent, { password: 'fixture-passkey-admin-password' });
    const admin = { ...intent, Cookie: cookie(login, 'foldergram_session') };
    const adminList = '/api/admin/family/' + alice.member.id + '/passkeys';
    expect((await requestTestApp(app, 'GET', adminList, admin)).body.items).toHaveLength(1);
    expect((await requestTestApp(app, 'GET', adminList, phone)).status).toBe(403);
    // Removing a key prevents new sign-ins; existing sessions remain separately revocable.
    expect((await requestTestApp(app, 'DELETE', adminList + '/' + keyId, admin)).status).toBe(200);
    attempt = await start();
    expect((await verify(attempt.headers, virtual.assert(attempt.challenge, handle, 2))).status).toBe(400);
    expect((await requestTestApp(app, 'GET', '/api/feed', newDevice)).status).toBe(200);
    revokeFamilyMember(alice.member.id);
    expect((await requestTestApp(app, 'GET', '/api/feed', newDevice)).status).toBe(401);
  });

  it('expires challenges and binds registration and credentials to the active identity and authentication generation', async () => {
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { createFamilyMember, revokeFamilyMember } = await import('../src/services/family-service.js');
    const app = createApp();
    const edge = { 'x-foldergram-intent': '1', Host: rpID, Origin: origin,
      'x-foldergram-external': '1', 'x-forwarded-proto': 'https' };
    const registration = '/api/family/passkeys/register';
    const authentication = '/api/auth/family-passkey';
    let now = Date.now() + 120000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      authService.setAdminPassword('fixture-passkey-rotation-password');
      const generation = authService.getFamilyGeneration()!;
      const alice = createFamilyMember('Rotation fixture', generation);
      const bob = createFamilyMember('Other fixture', generation);
      const join = async (token: string) => {
        const result = await requestTestApp(app, 'POST', '/api/auth/family-invite', edge, { token });
        expect(result.status).toBe(200);
        return { ...edge, Cookie: cookie(result, 'foldergram_session') };
      };
      const phone = await join(alice.token), other = await join(bob.token);
      const virtual = authenticator();
      const registerOptions = async () => {
        const result = await requestTestApp(app, 'POST', registration + '/options', phone, {});
        expect(result.status).toBe(200);
        return result;
      };
      let options = await registerOptions();
      const wrongSession = { ...other, Cookie: other.Cookie + '; ' + cookie(options, 'foldergram_passkey_challenge') };
      expect((await requestTestApp(app, 'POST', registration + '/verify', wrongSession, virtual.register(options.body.challenge))).status).toBe(400);
      expect((await requestTestApp(app, 'GET', '/api/family/passkeys', other)).body.items).toEqual([]);
      options = await registerOptions();
      const enrollment = { ...phone, Cookie: phone.Cookie + '; ' + cookie(options, 'foldergram_passkey_challenge') };
      expect((await requestTestApp(app, 'POST', registration + '/verify', enrollment, virtual.register(options.body.challenge))).status).toBe(200);
      const handle = options.body.user.id;
      const start = async () => {
        const result = await requestTestApp(app, 'POST', authentication + '/options', edge, {});
        expect(result.status).toBe(200);
        return { challenge: result.body.challenge as string, headers: { ...edge, Cookie: cookie(result, 'foldergram_passkey_challenge') } };
      };
      let attempt = await start();
      now += 301000;
      expect((await requestTestApp(app, 'POST', authentication + '/verify', attempt.headers, virtual.assert(attempt.challenge, handle, 1))).status).toBe(400);
      attempt = await start();
      authService.setAdminPassword('fixture-passkey-rotated-again');
      expect((await requestTestApp(app, 'POST', authentication + '/verify', attempt.headers, virtual.assert(attempt.challenge, handle, 1))).status).toBe(400);
      attempt = await start();
      expect((await requestTestApp(app, 'POST', authentication + '/verify', attempt.headers, virtual.assert(attempt.challenge, handle, 1))).status).toBe(400);
      revokeFamilyMember(alice.member.id);
      expect((await requestTestApp(app, 'GET', '/api/feed', phone)).status).toBe(401);
    } finally { clock.mockRestore(); }
  });
});
