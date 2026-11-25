import type { FeedItem } from '../types/api';

export interface PrintPhoto {
  key: string;
  postId: number;
  slideNumber: number | null;
  album: string;
  filename: string;
  thumbnailUrl: string;
}

// Favorites are post-level; offer individual still photographs from carousels.
// Never export originals, source paths, credentials or other family members' likes.
export function getPrintPhotos(items: FeedItem[]): PrintPhoto[] {
  const result: PrintPhoto[] = [];
  const seen = new Set<string>();
  for (const post of items) {
    const media = post.mediaItems?.length
      ? post.mediaItems
      : [{ ...post, imageId: post.id, position: 0 }];
    for (const item of media) {
      if (item.mediaType !== 'image') continue;
      const key = post.id + ':' + item.imageId;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        key, postId: post.id, slideNumber: post.mediaItems && post.mediaItems.length > 1 ? item.position + 1 : null,
        album: post.folderName, filename: item.filename.split(/[\\/]/).pop() || item.filename,
        thumbnailUrl: item.thumbnailUrl
      });
    }
  }
  return result;
}

export function singlePrintLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim();
}
