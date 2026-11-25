import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import { useAuthStore } from '../stores/auth';
import type { AuthStatus } from '../types/api';
import PublishingStudio from './PublishingStudio.vue';

vi.mock('../api/http', () => ({ requestJson: vi.fn() }));
const admin: AuthStatus = {
  enabled: true, authenticated: true, role: 'admin', accessMode: 'off', likesMode: 'shared',
  defaultLocale: null, publicDemoMode: false,
  capabilities: {canManageLibrary:true,canDeleteMedia:true,canAccessSettings:true,canUseSharedLikes:true,canUseLocalFavorites:true,canUseSharedCollections:true,canUseLocalCollections:true}
};
const albums=[{slug:'a',name:'A',defaultDraft:false},{slug:'b',name:'B',defaultDraft:true}];
const response=()=>({items:[],folders:albums.map(a=>({...a})),total:0,hasMore:false});

describe('album import policy',()=>{
  enableAutoUnmount(afterEach);
  beforeEach(()=>{setActivePinia(createPinia());vi.resetAllMocks();});
  it('does not expose publishing controls to family viewers',async()=>{
    useAuthStore().applyStatus({...admin,role:'viewer',likesMode:'family'});
    const wrapper=mount(PublishingStudio);
    await flushPromises();
    expect(wrapper.find('[data-test="publishing-studio"]').exists()).toBe(false);
    expect(requestJson).not.toHaveBeenCalled();
  });
  it('requires explicit save and loads each album setting independently',async()=>{
    useAuthStore().applyStatus(admin);
    vi.mocked(requestJson).mockResolvedValue(response());
    const wrapper=mount(PublishingStudio);
    const button=(label:string)=>wrapper.findAll('button').find(b=>b.text()===label)!;
    await button('Open studio').trigger('click');
    await flushPromises();
    const album=wrapper.get('select[aria-label="Album"]');
    await album.setValue('a');
    await flushPromises();
    const checkbox=()=>wrapper.get<HTMLInputElement>('input[aria-label="New posts start as drafts"]');
    expect(checkbox().element.checked).toBe(false);
    expect(button('Save import policy').element.disabled).toBe(true);
    const before=vi.mocked(requestJson).mock.calls.length;
    await checkbox().setValue(true);
    expect(requestJson).toHaveBeenCalledTimes(before);
    expect(button('Save import policy').element.disabled).toBe(false);
    vi.mocked(requestJson).mockResolvedValueOnce({folder:'a',defaultDraft:true});
    await button('Save import policy').trigger('click');
    await flushPromises();
    expect(requestJson).toHaveBeenLastCalledWith('/api/admin/publications/import-policy',expect.objectContaining({method:'PUT',body:'{"folder":"a","defaultDraft":true}'}));
    expect(wrapper.text()).toContain('Import policy saved.');
    expect(button('Save import policy').element.disabled).toBe(true);
    await album.setValue('b');
    await flushPromises();
    expect(checkbox().element.checked).toBe(true);
    await checkbox().setValue(false);
    await album.setValue('a');
    await flushPromises();
    expect(checkbox().element.checked).toBe(false);
    expect(button('Save import policy').element.disabled).toBe(true);
  });
});