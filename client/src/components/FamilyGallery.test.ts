import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useAuthStore } from '../stores/auth';
import { usePlacesStore } from '../stores/places';
import { useFamilyPresentation } from '../composables/useFamilyPresentation';
import type { AuthStatus, FolderSummary } from '../types/api';
import FamilyNavigation from './FamilyNavigation.vue';
import FamilyAlbumGrid from './FamilyAlbumGrid.vue';

const viewer: AuthStatus = {
  enabled: true, authenticated: true, role: 'viewer', accessMode: 'off',
  likesMode: 'family', defaultLocale: null, publicDemoMode: false,
  familyMember: { id: 'fixture-member', name: 'Fixture Family' }, externalFamilyAccess: true,
  capabilities: { canManageLibrary:false, canDeleteMedia:false, canAccessSettings:false,
    canUseSharedLikes:false, canUseSharedCollections:false, canUseLocalFavorites:false, canUseLocalCollections:true }
};
const empty = defineComponent({template:'<div />'});
async function makeRouter() {
  const router = createRouter({history:createMemoryHistory(),routes:[
    {name:'home',path:'/',component:empty},{name:'library',path:'/library',component:empty},
    {name:'explore',path:'/explore',component:empty},{name:'likes',path:'/likes/posts',component:empty},
    {name:'folder',path:'/f/:slug',component:empty},{name:'reels',path:'/reels',component:empty},
    {name:'places',path:'/places',component:empty},{name:'collections',path:'/collections',component:empty}
  ]});
  await router.push('/');
  await router.isReady();
  return router;
}
describe('family gallery presentation',()=>{
  enableAutoUnmount(afterEach);
  beforeEach(()=>{setActivePinia(createPinia());});
  it('only selects the simplified experience for authenticated named family viewers',()=>{
    const auth=useAuthStore();
    const family=useFamilyPresentation();
    expect(family.value).toBe(false);
    auth.applyStatus(viewer);
    expect(family.value).toBe(true);
    auth.applyStatus({...viewer,role:'admin',likesMode:'shared',familyMember:undefined,externalFamilyAccess:false});
    expect(family.value).toBe(false);
    auth.applyStatus({...viewer,authenticated:false,role:'anonymous',familyMember:undefined});
    expect(family.value).toBe(false);
  });
  it('provides four labeled primary destinations and preserves optional actions in More',async()=>{
    useAuthStore().applyStatus(viewer);
    vi.spyOn(usePlacesStore(),'fetchPlaces').mockResolvedValue(undefined);
    const router=await makeRouter();
    const wrapper=mount(FamilyNavigation,{global:{plugins:[router],stubs:{FamilyPushSettings:{template:'<div data-test="push-settings"/>'}}}});
    await flushPromises();
    expect(wrapper.findAll('.family-mobile-nav a').map(link=>link.text())).toEqual(['Home','Albums','Search','Favorites']);
    expect(wrapper.findAll('.family-desktop-nav a').map(link=>link.text())).toEqual(['Home','Albums','Search','Favorites']);
    expect(wrapper.get('.family-mobile-nav a[href="/"]').attributes('aria-current')).toBe('page');
    expect(wrapper.find('[data-test="push-settings"]').exists()).toBe(false);
    await wrapper.get('button[aria-label="More"]').trigger('click');
    expect(wrapper.get('.family-menu').text()).toContain('Fixture Family');
    expect(wrapper.get('.family-menu').text()).toContain('Collections');
    expect(wrapper.find('[data-test="push-settings"]').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    await flushPromises();
    expect(wrapper.find('.family-menu').exists()).toBe(false);
    await router.push('/f/event');
    await flushPromises();
    expect(wrapper.get('.family-mobile-nav a[href="/library"]').attributes('aria-current')).toBe('page');
  });
  it('renders photo-led album links without filesystem details',async()=>{
    const router=await makeRouter();
    const folder:FolderSummary={id:1,slug:'thanksgiving',name:'Thanksgiving',description:null,
      folderPath:'internal/storage/path',breadcrumb:null,imageCount:32,videoCount:0,
      latestImageMtimeMs:1700000000000,avatarImageId:2,avatarUrl:'/thumbnails/fixture.jpg'};
    const wrapper=mount(FamilyAlbumGrid,{props:{folders:[folder]},global:{plugins:[router]}});
    expect(wrapper.get('a').attributes('href')).toBe('/f/thanksgiving');
    expect(wrapper.get('img').attributes('src')).toBe('/thumbnails/fixture.jpg');
    expect(wrapper.text()).toContain('Thanksgiving');
    expect(wrapper.text()).toContain('32 items');
    expect(wrapper.text()).toContain('Updated');
    expect(wrapper.text()).not.toContain('internal/storage/path');
    await wrapper.setProps({preview:true});
    expect(wrapper.text()).not.toContain('Updated');
  });
});