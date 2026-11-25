import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/gallery';
import { RequestError } from '../api/http';
import type { FeedItem, FolderImagesPayload } from '../types/api';
import { useFoldersStore } from './folders';

function page(slug: string, ids: number[], pageNumber = 1, hasMore = true): FolderImagesPayload {
  const items: FeedItem[] = ids.map(id=>({
    id, folderId: 1, folderSlug:slug, folderName:slug, folderPath:slug, folderBreadcrumb:null,
    filename:id+'.jpg',width:1200,height:800,mediaType:'image',durationMs:null,
    thumbnailUrl:'/thumbnails/'+id+'.webp',previewUrl:'/previews/'+id+'.webp',sortTimestamp:id,takenAt:id
  }));
  return {folder:{id:1,slug,name:slug,description:null,folderPath:slug,breadcrumb:null,imageCount:120,
    videoCount:0,latestImageMtimeMs:null,avatarImageId:null,avatarUrl:null},
    items,page:pageNumber,limit:24,total:120,hasMore};
}
function deferred<T>() {
  let resolve!: (value:T)=>void;
  let reject!: (reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
beforeEach(()=>{setActivePinia(createPinia());vi.restoreAllMocks();});

describe('album browsing continuity',()=>{
  it('loads 120 posts across five pages, preserves the first 48 on failure and retries the same page',async()=>{
    const ids=(start:number,end:number)=>Array.from({length:end-start+1},(_,i)=>start+i);
    const fetch=vi.spyOn(api,'fetchFolderImages')
      .mockResolvedValueOnce(page('event',ids(1,24)))
      .mockResolvedValueOnce(page('event',ids(25,48),2))
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce(page('event',[48,...ids(49,72)],3))
      .mockResolvedValueOnce(page('event',ids(73,96),4))
      .mockResolvedValueOnce(page('event',ids(97,120),5,false));
    const store=useFoldersStore();
    await store.loadFolder('event');
    await store.loadFolder('event',false);
    const existing=store.currentImages.slice();
    await store.loadFolder('event',false);
    expect(store.currentImages).toEqual(existing);
    expect(store.currentFolder?.slug).toBe('event');
    expect(store.folderError).toBeNull();
    expect(store.folderPageError).toBe('Temporary network failure');
    expect(store.currentPage).toBe(3);
    await store.loadFolder('event',false);
    expect(store.folderPageError).toBeNull();
    await store.loadFolder('event',false);
    await store.loadFolder('event',false);
    expect(store.currentImages.map(i=>i.id)).toEqual(ids(1,120));
    expect(store.currentHasMore).toBe(false);
    await store.loadFolder('event',false);
    expect(fetch.mock.calls.map(c=>c[1])).toEqual([1,2,3,3,4,5]);
  });
  it('ignores late photos and late errors when moving between albums or switching to Reels',async()=>{
    const old=deferred<FolderImagesPayload>();
    const next=deferred<FolderImagesPayload>();
    const reel=deferred<FolderImagesPayload>();
    const fetch=vi.spyOn(api,'fetchFolderImages').mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise).mockReturnValueOnce(reel.promise);
    const store=useFoldersStore();
    const loadingOld=store.loadFolder('old');
    const loadingNext=store.loadFolder('next');
    old.resolve(page('old',[1]));
    await loadingOld;
    expect(store.currentFolder).toBeNull();
    expect(store.loadingFolder).toBe(true);
    const loadingReels=store.loadFolder('next',true,'video');
    next.reject(new Error('Old request failed'));
    await loadingNext;
    expect(store.folderError).toBeNull();
    expect(store.loadingFolder).toBe(true);
    reel.resolve(page('next',[3],1,false));
    await loadingReels;
    expect(store.currentImages.map(i=>i.id)).toEqual([3]);
    expect(store.currentFilter).toBe('video');
    expect(fetch).toHaveBeenLastCalledWith('next',1,24,'video');
  });
  it('drops cached posts when later pagination reports lost access',async()=>{
    vi.spyOn(api,'fetchFolderImages').mockResolvedValueOnce(page('event',[1,2]))
      .mockRejectedValueOnce(new RequestError('Album unavailable',403));
    const store=useFoldersStore();
    await store.loadFolder('event');
    await store.loadFolder('event',false);
    expect(store.currentImages).toEqual([]);
    expect(store.currentFolder).toBeNull();
    expect(store.folderPageError).toBeNull();
    expect(store.folderError).toBe('Album unavailable');
  });
  it('does not resurrect a removed album from a pending response',async()=>{
    const request=deferred<FolderImagesPayload>();
    vi.spyOn(api,'fetchFolderImages').mockReturnValueOnce(request.promise);
    const store=useFoldersStore();
    const load=store.loadFolder('event');
    store.removeFolder('event');
    request.resolve(page('event',[1]));
    await load;
    expect(store.currentFolder).toBeNull();
    expect(store.currentImages).toEqual([]);
    expect(store.loadingFolder).toBe(false);
  });
});