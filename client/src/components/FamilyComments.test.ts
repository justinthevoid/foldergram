import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import { useAuthStore } from '../stores/auth';
import type { AuthStatus } from '../types/api';
import FamilyComments from './FamilyComments.vue';
vi.mock('../api/http', () => ({ requestJson: vi.fn() }));

const family: AuthStatus = {
  enabled: true, authenticated: true, role: 'viewer', accessMode: 'off', likesMode: 'family',
  defaultLocale: null, publicDemoMode: false, familyMember: {id:'member-1',name:'Alice'},
  capabilities: {canManageLibrary:false,canDeleteMedia:false,canAccessSettings:false,canUseSharedLikes:false,canUseLocalFavorites:false,canUseSharedCollections:false,canUseLocalCollections:true}
};
const comment = {id:1,authorName:'Alice',body:'<img src=x onerror=alert(1)>',isOwner:false,createdAt:1700000000000,updatedAt:null,canEdit:true,canDelete:true};
describe('FamilyComments', () => {
  enableAutoUnmount(afterEach);
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); });
  it('is hidden while access is disabled or anonymous', async () => {
    const wrapper = mount(FamilyComments, {props:{postId:1}});
    await flushPromises();
    expect(wrapper.find('[data-test="family-comments"]').exists()).toBe(false);
    expect(requestJson).not.toHaveBeenCalled();
  });
  it('renders plain text and permits own edit and deletion after confirmation', async () => {
    useAuthStore().applyStatus(family);
    vi.mocked(requestJson).mockResolvedValueOnce({items:[comment],nextBeforeId:null});
    const wrapper = mount(FamilyComments,{props:{postId:100}});
    await flushPromises();
    expect(wrapper.text()).toContain(comment.body);
    expect(wrapper.find('img').exists()).toBe(false);
    const button = (label:string) => wrapper.findAll('button').find(b => b.text()===label)!;
    await button('Edit').trigger('click');
    expect(wrapper.get('textarea').element.value).toBe(comment.body);
    await wrapper.get('textarea').setValue('Edited');
    vi.mocked(requestJson).mockResolvedValueOnce({...comment,body:'Edited',updatedAt:1700000010000});
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(requestJson).toHaveBeenLastCalledWith('/api/family/posts/100/comments/1',expect.objectContaining({method:'PATCH',body:'{"body":"Edited"}'}));
    expect(wrapper.text()).toContain('Edited');
    await button('Delete').trigger('click');
    expect(wrapper.text()).toContain('Delete this comment?');
    vi.mocked(requestJson).mockResolvedValueOnce({ok:true});
    await wrapper.findAll('button').filter(b=>b.text()==='Delete').at(-1)!.trigger('click');
    await flushPromises();
    expect(requestJson).toHaveBeenLastCalledWith('/api/family/posts/100/comments/1',{method:'DELETE'});
    expect(wrapper.findAll('article')).toHaveLength(0);
  });
  it('drops old responses after switching photos or losing access', async () => {
    const auth=useAuthStore();auth.applyStatus(family);
    let resolve!: (value: unknown)=>void;
    vi.mocked(requestJson).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    const wrapper=mount(FamilyComments,{props:{postId:1}});
    vi.mocked(requestJson).mockResolvedValueOnce({items:[],nextBeforeId:null});
    await wrapper.setProps({postId:2});await flushPromises();
    resolve({items:[comment],nextBeforeId:null});await flushPromises();
    expect(wrapper.findAll('article')).toHaveLength(0);
    auth.handleUnauthorized();await flushPromises();
    expect(wrapper.find('[data-test="family-comments"]').exists()).toBe(false);
  });
});