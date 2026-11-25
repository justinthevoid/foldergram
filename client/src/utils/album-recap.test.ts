import { describe, expect, it } from 'vitest';
import type { FeedItem, PostMediaItem } from '../types/api';
import { getRecapPhotos, recapAspectRatio } from './album-recap';

const post = (id: number, extra: Partial<FeedItem> = {}): FeedItem => ({
  id, folderId: 1, folderSlug: 'event', folderName: 'Event', folderPath: 'event',
  folderBreadcrumb: null, filename: id + '.jpg', width: 1200, height: 800,
  mediaType: 'image', durationMs: null, thumbnailUrl: '/thumb/' + id,
  previewUrl: '/preview/' + id, sortTimestamp: id, takenAt: null, ...extra
});
const slide = (id: number, position: number, mediaType: 'image' | 'video'): PostMediaItem => ({
  imageId: id, position, filename: id + '.jpg', mediaType, width: 800, height: 1200,
  durationMs: null, isAnimated: false, thumbnailUrl: '/thumb/' + id, previewUrl: '/preview/' + id
});

describe('album recap', () => {
  it('preserves album and carousel order, skips videos, and keeps post captions and dates once', () => {
    const timestamp = Date.UTC(2026, 10, 25);
    const mixed = post(5, { mediaType: 'video', caption: '  Family gathering  ', takenAt: timestamp,
      mediaItems: [slide(50, 0, 'video'), slide(51, 1, 'image'), slide(52, 2, 'image')] });
    const photos = getRecapPhotos([post(9), mixed, post(3, { mediaType: 'video' }), mixed, post(1)]);
    expect(photos.map(photo => photo.key)).toEqual(['9:9', '5:51', '5:52', '1:1']);
    expect(photos.map(photo => photo.caption)).toEqual([null, 'Family gathering', null, null]);
    expect(photos.map(photo => photo.takenAt)).toEqual([null, timestamp, null, null]);
    expect(photos[1]).toMatchObject({ slideNumber: 2, previewUrl: '/preview/51' });
  });
  it('does not substitute a file modification date or format invalid capture dates', () => {
    const photos = getRecapPhotos([post(1), post(2, { takenAt: NaN }), post(3, { takenAt: 1e20 })]);
    expect(photos.every(photo => photo.takenAt === null)).toBe(true);
  });
  it('bounds display frames for portrait, panoramic and invalid dimensions', () => {
    expect(recapAspectRatio({ width: 1000, height: 4000 })).toBe(0.75);
    expect(recapAspectRatio({ width: 6000, height: 1000 })).toBe(2.4);
    expect(recapAspectRatio({ width: 1500, height: 1000 })).toBe(1.5);
    expect(recapAspectRatio({ width: 0, height: 0 })).toBe(4 / 3);
  });
});
