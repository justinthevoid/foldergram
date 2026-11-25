import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFolderImages } from '../api/gallery';
import type { FeedItem, FolderImagesPayload, FolderSummary } from '../types/api';
import LivingRoomSlideshow from './LivingRoomSlideshow.vue';

vi.mock('../api/gallery', async importOriginal => ({
  ...await importOriginal<typeof import('../api/gallery')>(),
  fetchFolderImages: vi.fn()
}));

const folder: FolderSummary = {
  id: 1, slug: 'event', name: 'Event', description: null, folderPath: 'event',
  breadcrumb: null, imageCount: 3, videoCount: 0, latestImageMtimeMs: null,
  avatarImageId: 1, avatarUrl: '/thumbnails/1.webp'
};
const photo = (id: number): FeedItem => ({
  id, folderId: 1, folderSlug: 'event', folderName: 'Event', folderPath: 'event',
  folderBreadcrumb: null, filename: id + '.jpg', width: 1200, height: 800,
  mediaType: 'image', durationMs: null, thumbnailUrl: '/thumbnails/' + id + '.webp',
  previewUrl: '/previews/' + id + '.webp', sortTimestamp: id, takenAt: null
});
const payload = (items: FeedItem[], page: number, hasMore: boolean): FolderImagesPayload =>
  ({ folder, items, page, hasMore, total: 3, limit: 24 });

function mountSlideshow() {
  return mount(LivingRoomSlideshow, {
    props: { slug: 'event', albumName: 'Event' },
    global: { stubs: { ProgressivePhoto: { props: ['alt'], template: '<div data-photo>{{ alt }}</div>' } } }
  });
}

describe('LivingRoomSlideshow', () => {
  enableAutoUnmount(afterEach);
  beforeEach(() => {
    vi.resetAllMocks();
    if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });
  afterEach(() => vi.useRealTimers());

  it('loads only the next page on demand, includes carousel photographs, skips videos and loops', async () => {
    const first = photo(1);
    const second = photo(2);
    const slide = (item: FeedItem, position: number) => ({
      imageId: item.id, position, filename: item.filename, mediaType: item.mediaType,
      width: item.width, height: item.height, durationMs: null, isAnimated: false,
      thumbnailUrl: item.thumbnailUrl, previewUrl: item.previewUrl
    });
    vi.mocked(fetchFolderImages)
      .mockResolvedValueOnce(payload([first, { ...photo(9), mediaType: 'video' }], 1, true))
      .mockResolvedValueOnce(payload([first, { ...photo(10), mediaItems: [slide(second, 0), slide({ ...photo(8), mediaType: 'video' }, 1), slide(photo(3), 2)] }], 2, false));
    const wrapper = mountSlideshow();
    await flushPromises();
    const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)!;
    const shown = () => wrapper.get('[data-photo]').text();
    expect(shown()).toBe('1.jpg');
    expect(fetchFolderImages).toHaveBeenCalledExactlyOnceWith('event', 1, 24, 'image');
    await button('Pause').trigger('click');
    await button('Next').trigger('click'); await flushPromises();
    expect(shown()).toBe('2.jpg');
    expect(fetchFolderImages).toHaveBeenLastCalledWith('event', 2, 24, 'image');
    await wrapper.get('dialog').trigger('keydown', { key: 'ArrowRight' });
    expect(shown()).toBe('3.jpg');
    await button('Next').trigger('click');
    expect(shown()).toBe('1.jpg');
    await button('Previous').trigger('click');
    expect(shown()).toBe('3.jpg');
    await button('Close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('keeps the current photograph and offers retry when the next page fails', async () => {
    vi.mocked(fetchFolderImages)
      .mockResolvedValueOnce(payload([photo(1)], 1, true))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(payload([photo(2)], 2, false));
    const wrapper = mountSlideshow();
    await flushPromises();
    const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)!;
    await button('Next').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-photo]').text()).toBe('1.jpg');
    expect(wrapper.get('[role="alert"]').text()).toContain("Couldn't load");
    expect(button('Play').exists()).toBe(true);
    await button('Retry').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-photo]').text()).toBe('2.jpg');
    expect(fetchFolderImages).toHaveBeenLastCalledWith('event', 2, 24, 'image');
  });

  it('automatically advances, pauses and stops on unmount', async () => {
    vi.mocked(fetchFolderImages).mockResolvedValue(payload([photo(1), photo(2)], 1, false));
    const wrapper = mountSlideshow();
    await flushPromises();
    vi.useFakeTimers();
    const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)!;
    await button('Pause').trigger('click');
    await button('Play').trigger('click');
    await vi.advanceTimersByTimeAsync(8000);
    expect(wrapper.get('[data-photo]').text()).toBe('2.jpg');
    await button('Pause').trigger('click');
    await vi.advanceTimersByTimeAsync(16000);
    expect(wrapper.get('[data-photo]').text()).toBe('2.jpg');
    await button('Play').trigger('click');
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows an empty state and does not advance an empty album', async () => {
    vi.mocked(fetchFolderImages).mockResolvedValue(payload([], 1, false));
    const wrapper = mountSlideshow();
    await flushPromises();
    expect(wrapper.text()).toContain('No photographs in this album.');
    expect(wrapper.find('[data-photo]').exists()).toBe(false);
  });
});
