import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useBrandingStore } from './branding';
import { requestJson } from '../api/http';

vi.mock('../api/http', () => ({ requestJson: vi.fn() }));

describe('gallery branding', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); });
  it('loads the public name and private profile independently, then clears the profile on logout', async () => {
    const store = useBrandingStore();
    vi.mocked(requestJson).mockResolvedValueOnce({ name: 'Field Notes', logo: '' });
    await store.loadPublic();
    expect(document.title).toBe('Field Notes');
    expect(store.value.bio).toBe('');
    vi.mocked(requestJson).mockResolvedValueOnce({ name: 'Field Notes', photographer: 'Example', bio: 'Private', logo: '' });
    await store.loadProfile();
    expect(store.ready).toBe(true);
    expect(store.value.bio).toBe('Private');
    store.clearProfile();
    expect(store.value).toEqual({ name: 'Field Notes', photographer: '', bio: '', logo: '' });
    expect(store.ready).toBe(false);
  });
  it('ignores an in-flight profile response after logout', async () => {
    const store = useBrandingStore();
    let resolve!: (value: unknown) => void;
    vi.mocked(requestJson).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const loading = store.loadProfile();
    store.clearProfile();
    resolve({ name: 'Field Notes', photographer: 'Example', bio: 'Private', logo: '' });
    await loading;
    expect(store.value.bio).toBe('');
    expect(store.ready).toBe(false);
  });
});