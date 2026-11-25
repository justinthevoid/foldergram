import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as galleryApi from '../api/gallery';
import type { FeedItem, FolderStoriesPayload, FolderStoryFeedPayload } from '../types/api';
import { useFolderStoriesStore } from './folder-stories';

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 14,
    folderSlug: 'beach-club',
    folderName: 'Beach Club',
    folderPath: 'albums/beach-club',
    folderBreadcrumb: null,
    filename: `story-${id}.jpg`,
    width: 1080,
    height: 1920,
    mediaType: 'image',
    durationMs: null,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_778_400_000_000 + id,
    takenAt: 1_778_400_000_000 + id
  };
}

function createStoriesPayload(): FolderStoriesPayload {
  const coverImage = createFeedItem(31);

  return {
    railKind: 'stories',
    railTitle: 'Stories',
    railDescription: 'Stories and highlights for Beach Club.',
    railSingularLabel: 'Story',
    hasAvatarStory: true,
    avatarStoryId: 'beach-club-story',
    items: [
      {
        id: 'beach-club-story',
        title: 'Beach Club',
        subtitle: 'Beach Club story set',
        dateContext: 'Latest Mar 28, 2026',
        latestActivityTimestamp: new Date('2026-03-28T12:00:00.000Z').getTime(),
        imageCount: 1,
        presentation: 'avatar',
        coverImage
      }
    ],
    highlights: []
  };
}

describe('folder stories store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('discards late story rails from another album and after logout reset', async () => {
    let resolveOld!: (value:FolderStoriesPayload)=>void;
    let resolveReset!: (value:FolderStoriesPayload)=>void;
    const old=new Promise<FolderStoriesPayload>(resolve=>{resolveOld=resolve;});
    const resetting=new Promise<FolderStoriesPayload>(resolve=>{resolveReset=resolve;});
    const fresh={...createStoriesPayload(),avatarStoryId:'next-story',items:[]};
    vi.spyOn(galleryApi,'fetchFolderStories').mockReturnValueOnce(old).mockResolvedValueOnce(fresh).mockReturnValueOnce(resetting);
    const store=useFolderStoriesStore();
    const loading=store.fetchStories('old');
    await store.fetchStories('next');
    resolveOld(createStoriesPayload());
    await loading;
    expect(store.currentFolderSlug).toBe('next');
    expect(store.avatarStoryId).toBe('next-story');
    expect(store.items).toEqual([]);
    const pending=store.fetchStories('next',true);
    store.reset();
    resolveReset(createStoriesPayload());
    await pending;
    expect(store.currentFolderSlug).toBeNull();
    expect(store.items).toEqual([]);
    expect(store.loadingList).toBe(false);
  });

  it('ignores a late capsule page after a different story is selected', async () => {
    const store=useFolderStoriesStore();
    const rail=createStoriesPayload();
    const story=rail.items[0]!;
    vi.spyOn(galleryApi,'fetchFolderStories').mockResolvedValue(rail);
    await store.fetchStories('beach-club');
    let resolveOld!: (value:FolderStoryFeedPayload)=>void;
    const pending=new Promise<FolderStoryFeedPayload>(resolve=>{resolveOld=resolve;});
    const response=(id:string,imageId:number):FolderStoryFeedPayload=>({
      railKind:'stories',railTitle:rail.railTitle,railDescription:rail.railDescription,
      railSingularLabel:rail.railSingularLabel,story:{...story,id},items:[createFeedItem(imageId)],
      page:1,limit:18,total:1,hasMore:false
    });
    vi.spyOn(galleryApi,'fetchFolderStoryFeed').mockReturnValueOnce(pending).mockResolvedValueOnce(response('second',42));
    const old=store.loadCapsule('first');
    await store.loadCapsule('second');
    resolveOld(response('first',31));
    await old;
    expect(store.currentStory?.id).toBe('second');
    expect(store.currentImages.map(item=>item.id)).toEqual([42]);
    expect(store.loadingStory).toBe(false);
  });
  it('retries the same folder after a previous fetch failure', async () => {
    const fetchFolderStoriesSpy = vi
      .spyOn(galleryApi, 'fetchFolderStories')
      .mockRejectedValueOnce(new Error('Temporary stories failure'))
      .mockResolvedValueOnce(createStoriesPayload());

    const store = useFolderStoriesStore();

    await store.fetchStories('beach-club');
    expect(store.listError).toBe('Temporary stories failure');
    expect(store.items).toHaveLength(0);

    await store.fetchStories('beach-club');

    expect(fetchFolderStoriesSpy).toHaveBeenCalledTimes(2);
    expect(store.listError).toBeNull();
    expect(store.items).toHaveLength(1);
    expect(store.avatarStoryId).toBe('beach-club-story');
  });
});
