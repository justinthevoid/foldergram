import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { requestJson } from '../api/http';
import { useAuthStore } from './auth';
import type { AuthStatus } from '../types/api';

vi.mock('../api/http', () => ({ requestJson: vi.fn() }));

const identity = { id: '00000000-0000-4000-8000-000000000001', name: 'Example' };
const status: AuthStatus = {
  enabled: true, authenticated: true, role: 'viewer', accessMode: 'off', likesMode: 'family',
  defaultLocale: null, familyMember: identity, publicDemoMode: false,
  capabilities: { canManageLibrary: false, canDeleteMedia: false, canAccessSettings: false, canUseSharedLikes: false, canUseLocalFavorites: false, canUseSharedCollections: false, canUseLocalCollections: true }
};

describe('named family sessions', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); });
  it('accepts the invitation without storing its token, and clears the identity after revocation', async () => {
    const auth = useAuthStore();
    vi.mocked(requestJson).mockResolvedValueOnce({ ok: true, auth: status });
    const token = 'a'.repeat(43);
    await auth.acceptFamilyInvite(token);
    expect(requestJson).toHaveBeenCalledWith('/api/auth/family-invite', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token }) }));
    expect(auth.familyMember).toEqual(identity);
    expect(JSON.stringify(auth.$state)).not.toContain(token);
    expect(auth.canAccessSettings).toBe(false);
    expect(auth.canUseSharedLikes).toBe(false);
    auth.handleUnauthorized();
    expect(auth.familyMember).toBeNull();
    expect(auth.requiresLogin).toBe(true);
  });
});