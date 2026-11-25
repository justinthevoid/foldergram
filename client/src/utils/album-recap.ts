import type { FeedItem } from '../types/api';
import { getPostPhotos, type PostPhoto } from './post-photos';

export interface RecapPhoto extends PostPhoto {
  caption: string | null;
  takenAt: number | null;
}

/** Keep the album's chosen order. A post's caption/date appears only once. */
export function getRecapPhotos(posts: FeedItem[]): RecapPhoto[] {
  const seen = new Set<string>();
  const result: RecapPhoto[] = [];
  for (const post of posts) {
    let first = true;
    for (const photo of getPostPhotos(post)) {
      if (seen.has(photo.key)) { first = false; continue; }
      seen.add(photo.key);
      const timestamp = post.takenAt;
      result.push({
        ...photo,
        caption: first ? post.caption?.trim() || null : null,
        takenAt: first && timestamp !== null && Number.isFinite(timestamp) &&
          Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null
      });
      first = false;
    }
  }
  return result;
}

/** Keep portrait and panorama photographs intact while bounding the frame. */
export function recapAspectRatio(photo: Pick<PostPhoto, 'width' | 'height'>): number {
  if (!Number.isFinite(photo.width) || !Number.isFinite(photo.height) ||
      photo.width <= 0 || photo.height <= 0) return 4 / 3;
  return Math.min(2.4, Math.max(0.75, photo.width / photo.height));
}
