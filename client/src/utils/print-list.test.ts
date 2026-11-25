import { describe, expect, it } from 'vitest';
import type { FeedItem, PostMediaItem } from '../types/api';
import { getPrintPhotos, singlePrintLine } from './print-list';

const photo = (id: number): FeedItem => ({
  id, folderId: 1, folderSlug: 'event', folderName: 'Event', folderPath: 'private/path',
  folderBreadcrumb: null, filename: id + '.jpg', width: 1200, height: 800,
  mediaType: 'image', durationMs: null, thumbnailUrl: '/thumbnails/' + id + '.webp',
  previewUrl: '/previews/' + id + '.webp', sortTimestamp: id, takenAt: null
});
const slide = (id: number, position: number, mediaType: 'image' | 'video' = 'image'): PostMediaItem => ({
  imageId: id, position, filename: id + '.jpg', mediaType,
  width: 1200, height: 800, durationMs: null, isAnimated: false,
  thumbnailUrl: '/thumbnails/' + id + '.webp', previewUrl: '/previews/' + id + '.webp'
});

describe('print-list candidates', () => {
  it('selects individual still photographs in favorite order, skips videos and deduplicates repeated posts', () => {
    const single = photo(1);
    const carousel = { ...photo(2), mediaItems: [slide(7, 0), slide(8, 1, 'video'), slide(9, 2)] };
    const result = getPrintPhotos([single, { ...photo(3), mediaType: 'video' }, carousel, single]);
    expect(result.map(item => [item.key, item.postId, item.slideNumber])).toEqual([
      ['1:1', 1, null], ['2:7', 2, 1], ['2:9', 2, 3]
    ]);
    expect(result[0]).toEqual({
      key: '1:1', postId: 1, slideNumber: null, album: 'Event',
      filename: '1.jpg', thumbnailUrl: '/thumbnails/1.webp'
    });
  });
  it('exports only a basename and keeps metadata on a single text line', () => {
    const items = getPrintPhotos([{ ...photo(4), filename: 'private\\folder/photo.jpg' }]);
    expect(items[0]?.filename).toBe('photo.jpg');
    expect(singlePrintLine(' Family\nEvent\t2026 ')).toBe('Family Event 2026');
  });
});
