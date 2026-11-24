import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import type { AuthStatus, FeedItem } from '../types/api';
import { useAuthStore } from './auth';
import { useLikesStore } from './likes';
import { useFamilyReactionsStore } from './family-reactions';

vi.mock('../api/http', () => ({ requestJson: vi.fn() }));
const photo = (id: number): FeedItem => ({
  id, folderId: 1, folderSlug: 'fixture', folderName: 'Fixture', folderPath: 'fixture',
  folderBreadcrumb: null, filename: 'photo.jpg', width: 800, height: 600,
  mediaType: 'image', durationMs: null, isAnimated: false, thumbnailUrl: '/thumbs/photo.webp',
  previewUrl: '/previews/photo.webp', sortTimestamp: id, takenAt: id
});
const family: AuthStatus = {
  enabled: true, authenticated: true, role: 'viewer', accessMode: 'off', likesMode: 'family',
  publicDemoMode: false, defaultLocale: null,
  familyMember: { id: '00000000-0000-4000-8000-000000000001', name: 'Alice' },
  capabilities: { canManageLibrary: false, canDeleteMedia: false, canAccessSettings: false,
    canUseSharedLikes: false, canUseLocalFavorites: false, canUseSharedCollections: false, canUseLocalCollections: true }
};

describe('named family photo reactions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    window.localStorage.clear();
  });

  it('loads and toggles server-backed likes without altering browser favorites', async () => {
    useAuthStore().applyStatus(family);
    window.localStorage.setItem('foldergram-local-favorites', JSON.stringify([photo(3)]));
    vi.mocked(requestJson).mockResolvedValueOnce({ items: [photo(1)] });
    const likes = useLikesStore();
    await likes.initialize();
    expect(likes.likedIds).toEqual([1]);
    expect(likes.mode).toBe('family');
    vi.mocked(requestJson).mockResolvedValueOnce({ id: 2, liked: true });
    await likes.toggleLike(photo(2));
    expect(requestJson).toHaveBeenLastCalledWith('/api/family/posts/2/like', expect.objectContaining({ method: 'PUT', body: '{"liked":true}' }));
    expect(likes.likedIds).toEqual([2, 1]);
    vi.mocked(requestJson).mockResolvedValueOnce({ id: 1, liked: false });
    await likes.toggleLike(photo(1));
    expect(requestJson).toHaveBeenLastCalledWith('/api/family/posts/1/like', expect.objectContaining({ method: 'PUT', body: '{"liked":false}' }));
    expect(likes.likedIds).toEqual([2]);
    expect(JSON.parse(window.localStorage.getItem('foldergram-local-favorites')!)).toEqual([photo(3)]);
  });

  it('never requests named reaction summaries as a family viewer or with protection off', async () => {
    const auth = useAuthStore();
    auth.applyStatus(family);
    const reactions = useFamilyReactionsStore();
    reactions.load(1);
    await Promise.resolve();
    expect(requestJson).not.toHaveBeenCalled();
    auth.$patch({ role: 'admin', enabled: false });
    reactions.load(2);
    await Promise.resolve();
    expect(requestJson).not.toHaveBeenCalled();
  });

  it('batches owner lookups and clears results when reset', async () => {
    const auth = useAuthStore();
    auth.applyStatus({ ...family, familyMember: undefined, role: 'admin', likesMode: 'shared' });
    const reactions = useFamilyReactionsStore();
    vi.mocked(requestJson).mockResolvedValueOnce({ items: { '1': ['Alice'], '2': ['Bob'] } });
    reactions.load(1);
    reactions.load(2);
    await vi.waitFor(() => expect(reactions.entries[2]?.names).toEqual(['Bob']));
    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledWith('/api/admin/family/reactions?ids=1,2');
    expect(reactions.entries[1]?.names).toEqual(['Alice']);
    reactions.reset();
    expect(reactions.entries).toEqual({});
  });
});