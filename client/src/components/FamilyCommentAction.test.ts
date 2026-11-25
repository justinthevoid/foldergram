import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import { useAuthStore } from '../stores/auth';
import type { AuthStatus } from '../types/api';
import FamilyCommentAction from './FamilyCommentAction.vue';
vi.mock('../api/http',()=>({requestJson:vi.fn()}));
const family:AuthStatus={
 enabled:true,authenticated:true,role:'viewer',accessMode:'off',likesMode:'family',
 defaultLocale:null,publicDemoMode:false,familyMember:{id:'fixture',name:'Family'},
 capabilities:{canManageLibrary:false,canDeleteMedia:false,canAccessSettings:false,canUseSharedLikes:false,canUseLocalFavorites:false,canUseSharedCollections:false,canUseLocalCollections:true}
};
describe('FamilyCommentAction',()=>{
 enableAutoUnmount(afterEach);
 beforeEach(()=>{
  setActivePinia(createPinia());vi.resetAllMocks();
  if(!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  if(!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 });
 it('only loads comments when opened, saves them on the current post and closes on post or identity changes',async()=>{
   const auth=useAuthStore();auth.applyStatus(family);
   const wrapper=mount(FamilyCommentAction,{attachTo:document.body,props:{postId:12},global:{stubs:{Teleport:true}}});
   expect(requestJson).not.toHaveBeenCalled();
   const button=()=>wrapper.get('button[aria-label="Comments"]');
   vi.mocked(requestJson).mockResolvedValueOnce({items:[],nextBeforeId:null});
   await button().trigger('click');await flushPromises();
   expect(button().attributes('aria-expanded')).toBe('true');
   expect(wrapper.get('dialog').attributes('open')).toBeDefined();
   expect(requestJson).toHaveBeenCalledWith(expect.stringContaining('/api/family/posts/12/comments'));
   await wrapper.get('textarea').setValue('Lovely photo!');
   vi.mocked(requestJson).mockResolvedValueOnce({id:1,authorName:'Family',body:'Lovely photo!',createdAt:1700000000000,updatedAt:null,canEdit:true,canDelete:true});
   await wrapper.get('form').trigger('submit');await flushPromises();
   expect(requestJson).toHaveBeenLastCalledWith('/api/family/posts/12/comments',expect.objectContaining({method:'POST',body:'{"body":"Lovely photo!"}'}));
   expect(wrapper.text()).toContain('Lovely photo!');
   await wrapper.setProps({postId:13});await flushPromises();
   expect(wrapper.find('dialog').exists()).toBe(false);
   expect(button().attributes('aria-expanded')).toBe('false');
   vi.mocked(requestJson).mockResolvedValueOnce({items:[],nextBeforeId:null});
   await button().trigger('click');await flushPromises();
   expect(requestJson).toHaveBeenLastCalledWith(expect.stringContaining('/api/family/posts/13/comments'));
   auth.handleUnauthorized();await flushPromises();
   expect(wrapper.find('dialog').exists()).toBe(false);
   expect(wrapper.find('button').exists()).toBe(false);
 });
 it('does not expose comments to anonymous users',()=>{
   const wrapper=mount(FamilyCommentAction,{props:{postId:1},global:{stubs:{Teleport:true}}});
   expect(wrapper.find('button').exists()).toBe(false);
   expect(requestJson).not.toHaveBeenCalled();
 });
});