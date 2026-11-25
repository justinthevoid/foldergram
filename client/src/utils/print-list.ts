import type { FeedItem } from '../types/api';
import { getPostPhotos } from './post-photos';

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
    for (const item of getPostPhotos(post)) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      result.push({
        key: item.key, postId: post.id, slideNumber: item.slideNumber,
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
