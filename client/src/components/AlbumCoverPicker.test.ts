import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFolderImages } from '../api/gallery';
import { useAuthStore } from '../stores/auth';
import { useFoldersStore } from '../stores/folders';
import type { FeedItem, FolderSummary, FolderImagesPayload } from '../types/api';
import AlbumCoverPicker from './AlbumCoverPicker.vue';
vi.mock('../api/gallery',async(importOriginal)=>({
  ...await importOriginal<typeof import('../api/gallery')>(), fetchFolderImages:vi.fn()
}));
const folder:FolderSummary={id:1,slug:'event',name:'Event',description:null,folderPath:'event',breadcrumb:null,imageCount:3,videoCount:0,latestImageMtimeMs:null,avatarImageId:1,avatarUrl:'/thumbnails/1.webp'};
const photo=(id:number):FeedItem=>({id,folderId:1,folderSlug:'event',folderName:'Event',folderPath:'event',folderBreadcrumb:null,filename:id+'.jpg',width:1200,height:800,mediaType:'image',durationMs:null,thumbnailUrl:'/thumbnails/'+id+'.webp',previewUrl:'/previews/'+id+'.webp',sortTimestamp:id,takenAt:null});
const payload=(items:FeedItem[],page:number,hasMore:boolean):FolderImagesPayload=>({folder,items,page,hasMore,total:3,limit:24});
describe('AlbumCoverPicker',()=>{
 enableAutoUnmount(afterEach);
 beforeEach(()=>{
   setActivePinia(createPinia());vi.resetAllMocks();
   // The DOM test runner lacks the native top-layer implementation.
   if(!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
   if(!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 });
 it('paginates album-specific photographs and saves only an explicit selection',async()=>{
   vi.mocked(fetchFolderImages).mockResolvedValueOnce(payload([photo(1),photo(2)],1,true)).mockResolvedValueOnce(payload([photo(2),photo(3)],2,false));
   const save=vi.spyOn(useFoldersStore(),'setFolderCover').mockResolvedValue(undefined);
   const wrapper=mount(AlbumCoverPicker,{props:{slug:'event',currentCoverId:1}});
   await flushPromises();
   expect(fetchFolderImages).toHaveBeenCalledWith('event',1,24,'image');
   expect(wrapper.get('button[aria-label="1.jpg"]').attributes('aria-current')).toBe('true');
   const button=(label:string)=>wrapper.findAll('button').find(b=>b.text()===label)!;
   expect(button('Save cover').element.disabled).toBe(true);
   await button('Load more').trigger('click');await flushPromises();
   expect(fetchFolderImages).toHaveBeenLastCalledWith('event',2,24,'image');
   expect(wrapper.findAll('.album-cover-picker__item')).toHaveLength(3);
   await wrapper.get('button[aria-label="3.jpg"]').trigger('click');
   expect(save).not.toHaveBeenCalled();
   await button('Save cover').trigger('click');await flushPromises();
   expect(save).toHaveBeenCalledWith('event',3);
   expect(wrapper.emitted('close')).toHaveLength(1);
 });
 it('does not load or save if the viewer is not permitted to manage the album',async()=>{
   useAuthStore().applyStatus({enabled:true,authenticated:true,role:'viewer',accessMode:'off',likesMode:'family',defaultLocale:null,externalFamilyAccess:true,familyMember:{id:'fixture',name:'Family'},capabilities:{canManageLibrary:false,canDeleteMedia:false,canAccessSettings:false,canUseSharedLikes:false,canUseLocalFavorites:false,canUseSharedCollections:false,canUseLocalCollections:true}});
   const wrapper=mount(AlbumCoverPicker,{props:{slug:'event',currentCoverId:null}});
   await flushPromises();
   expect(fetchFolderImages).not.toHaveBeenCalled();
   expect(wrapper.emitted('close')).toHaveLength(1);
 });
});