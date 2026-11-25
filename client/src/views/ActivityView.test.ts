import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import { useAuthStore } from '../stores/auth';
import type { AuthStatus } from '../types/api';
import ActivityView from './ActivityView.vue';
import FamilyActivityLink from '../components/FamilyActivityLink.vue';
vi.mock('../api/http',()=>({requestJson:vi.fn()}));
const admin:AuthStatus={
 enabled:true,authenticated:true,role:'admin',accessMode:'off',likesMode:'shared',defaultLocale:null,publicDemoMode:false,
 capabilities:{canManageLibrary:true,canDeleteMedia:true,canAccessSettings:true,canUseSharedLikes:true,canUseLocalFavorites:true,canUseSharedCollections:true,canUseLocalCollections:true}
};
const item={id:2,postId:100,kind:'comment',createdAt:1700000000000,readAt:null,memberName:'Alice',body:'<b>Plain text</b>',filename:'photo.jpg',folderName:'Family',thumbnailUrl:'/thumbnails/photo.webp'};
const result={items:[item],unread:2,snapshot:2,nextBeforeId:2};
const older={...item,id:1,kind:'like',body:null,memberName:'Bob'};
const global={stubs:{RouterLink:{template:'<a><slot /></a>',props:['to']}}};
describe('private family activity UI',()=>{
 enableAutoUnmount(afterEach);
 beforeEach(()=>{setActivePinia(createPinia());vi.resetAllMocks();});
 it('hides the link and page for family viewers',async()=>{
  useAuthStore().applyStatus({...admin,role:'viewer',likesMode:'family'});
  const page=mount(ActivityView,{global}),link=mount(FamilyActivityLink,{global});
  await flushPromises();
  expect(page.find('main').exists()).toBe(false);
  expect(link.find('a').exists()).toBe(false);
  expect(requestJson).not.toHaveBeenCalled();
 });
 it('shows current text safely, loads older entries and acknowledges only the initial snapshot',async()=>{
  useAuthStore().applyStatus(admin);
  vi.mocked(requestJson).mockResolvedValueOnce(result);
  const wrapper=mount(ActivityView,{global});
  await flushPromises();
  expect(wrapper.text()).toContain('Alice commented on your photograph.');
  expect(wrapper.text()).toContain(item.body);
  expect(wrapper.find('b').exists()).toBe(false);
  vi.mocked(requestJson).mockResolvedValueOnce({items:[older],unread:3,snapshot:3,nextBeforeId:null});
  const button=(label:string)=>wrapper.findAll('button').find(b=>b.text()===label)!;
  await button('Load older activity').trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('Bob liked your photograph.');
  vi.mocked(requestJson).mockResolvedValueOnce({changed:2,unread:1});
  await button('Mark all as read').trigger('click');await flushPromises();
  expect(requestJson).toHaveBeenLastCalledWith('/api/admin/activity/read',expect.objectContaining({method:'POST',body:'{"throughId":2}'}));
  expect(wrapper.findAll('button').some(b=>b.text()==='Mark as read')).toBe(false);
  expect(wrapper.text()).toContain('Unread(1)');
 });
 it('loads the home unread count and clears it when the owner signs out',async()=>{
  const auth=useAuthStore();auth.applyStatus(admin);
  vi.mocked(requestJson).mockResolvedValueOnce({unread:3});
  const wrapper=mount(FamilyActivityLink,{global});await flushPromises();
  expect(wrapper.text()).toContain('3 unread');
  auth.handleUnauthorized();await flushPromises();
  expect(wrapper.find('a').exists()).toBe(false);
 });
});