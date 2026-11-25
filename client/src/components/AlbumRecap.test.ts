import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FeedItem } from '../types/api';
import AlbumRecap from './AlbumRecap.vue';

const photo = (id: number, extra: Partial<FeedItem> = {}): FeedItem => ({
  id, folderId: 1, folderSlug: 'event', folderName: 'Event', folderPath: 'event',
  folderBreadcrumb: null, filename: id + '.jpg', width: 1200, height: 800,
  mediaType: 'image', durationMs: null, thumbnailUrl: '/thumb/' + id,
  previewUrl: '/preview/' + id, sortTimestamp: id, takenAt: null, ...extra
});

function mountRecap(items: FeedItem[], hasMore = false) {
  return mount(AlbumRecap, {
    props: { albumName: 'Family gathering', description: 'A day together', items, hasMore, loading: false },
    global: { stubs: { ResilientImage: { props: ['src', 'alt'], template: '<img :src="src" :alt="alt" />' } } }
  });
}

describe('AlbumRecap', () => {
  enableAutoUnmount(afterEach);
  beforeEach(() => {
    if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });

  it('uses the real title, description, caption and known date without adding video frames', () => {
    const wrapper = mountRecap([
      photo(1, { caption: 'Our family photo', takenAt: Date.UTC(2026, 10, 25) }),
      photo(2, { mediaType: 'video' }),
      photo(3)
    ]);
    expect(wrapper.get('h2').text()).toBe('Family gathering');
    expect(wrapper.text()).toContain('A day together');
    expect(wrapper.findAll('figure')).toHaveLength(2);
    expect(wrapper.findAll('time')).toHaveLength(1);
    expect(wrapper.get('figcaption').text()).toContain('Our family photo');
    expect(wrapper.get('figure').classes()).toContain('album-recap__figure--wide');
    expect(wrapper.text()).toContain("You've reached the end");
  });

  it('reveals already loaded photos before requesting another page and preserves the recap on retry', async () => {
    const items = Array.from({ length: 14 }, (_, i) => photo(i + 1));
    const wrapper = mountRecap(items, true);
    const button = (label: string) => wrapper.findAll('button').find(b => b.text() === label)!;
    expect(wrapper.findAll('figure')).toHaveLength(12);
    await button('Load more').trigger('click');
    expect(wrapper.findAll('figure')).toHaveLength(14);
    expect(wrapper.emitted('loadMore')).toBeUndefined();
    await button('Load more').trigger('click');
    expect(wrapper.emitted('loadMore')).toHaveLength(1);
    await wrapper.setProps({ loading: true });
    expect(button('Load more').element.disabled).toBe(true);
    await wrapper.setProps({ loading: false, pageError: 'offline' });
    expect(wrapper.findAll('figure')).toHaveLength(14);
    expect(wrapper.get('[role="alert"]').text()).toContain("Couldn't load");
    await button('Retry').trigger('click');
    expect(wrapper.emitted('loadMore')).toHaveLength(2);
    await wrapper.setProps({ pageError: null, hasMore: false, items: [...items, photo(15)] });
    expect(wrapper.findAll('figure')).toHaveLength(15);
    expect(wrapper.text()).toContain("You've reached the end");
    await button('Close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers additional pages if the loaded posts contain only videos', async () => {
    const wrapper = mountRecap([photo(1, { mediaType: 'video' })], true);
    expect(wrapper.findAll('figure')).toHaveLength(0);
    await wrapper.findAll('button').find(b => b.text() === 'Load more')!.trigger('click');
    expect(wrapper.emitted('loadMore')).toHaveLength(1);
    await wrapper.setProps({ hasMore: false });
    expect(wrapper.text()).toContain('There are no photographs in this album.');
  });
});
