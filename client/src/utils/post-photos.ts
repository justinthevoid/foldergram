import type { FeedItem } from '../types/api';

export interface PostPhoto {
  key: string;
  imageId: number;
  filename: string;
  slideNumber: number | null;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
}

/** The still photographs of a post, retaining carousel order and post-scoped identity. */
export function getPostPhotos(post: FeedItem): PostPhoto[] {
  const media = post.mediaItems?.length
    ? post.mediaItems
    : [{ ...post, imageId: post.id, position: 0 }];
  const multiple = (post.mediaItems?.length ?? 0) > 1;
  return media.filter(item => item.mediaType === 'image').map(item => ({
    key: post.id + ':' + item.imageId,
    imageId: item.imageId,
    filename: item.filename,
    slideNumber: multiple ? item.position + 1 : null,
    thumbnailUrl: item.thumbnailUrl,
    previewUrl: item.previewUrl,
    width: item.width,
    height: item.height
  }));
}
