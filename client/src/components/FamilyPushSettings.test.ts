import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import { useAuthStore } from '../stores/auth';
import type { AuthStatus } from '../types/api';
import FamilyPushSettings from './FamilyPushSettings.vue';
vi.mock('../api/http',()=>({requestJson:vi.fn()}));
const viewer:AuthStatus={
 enabled:true,authenticated:true,role:'viewer',accessMode:'off',likesMode:'family',defaultLocale:null,publicDemoMode:false,
 familyMember:{id:'fixture-member',name:'Fixture'},externalFamilyAccess:true,
 capabilities:{canManageLibrary:false,canDeleteMedia:false,canAccessSettings:false,canUseSharedLikes:false,canUseLocalFavorites:false,canUseSharedCollections:false,canUseLocalCollections:true}
};
const publicKey='B'+'A'.repeat(86);
const payload={endpoint:'https://fcm.googleapis.com/fcm/send/fixture-browser',keys:{p256dh:'fixture-public',auth:'fixture-auth'},expirationTime:null};
describe('family push opt-in',()=>{
 enableAutoUnmount(afterEach);
 beforeEach(()=>{setActivePinia(createPinia());vi.resetAllMocks();});
 afterEach(()=>vi.unstubAllGlobals());
 it('is not available to administrator or anonymous visitors',()=>{
  useAuthStore().applyStatus({...viewer,role:'admin',familyMember:undefined,externalFamilyAccess:false});
  const wrapper=mount(FamilyPushSettings);
  expect(wrapper.find('[data-test="family-push"]').exists()).toBe(false);
  expect(requestJson).not.toHaveBeenCalled();
 });
 it('shows installation help without prompting on unsupported browsers',async()=>{
  vi.stubGlobal('isSecureContext',false);
  useAuthStore().applyStatus(viewer);
  const wrapper=mount(FamilyPushSettings);await flushPromises();
  expect(wrapper.text()).toContain('Add to Home Screen');
  expect(requestJson).not.toHaveBeenCalled();
 });
 it('requires an explicit click, then registers and removes a device',async()=>{
  const permission=vi.fn(async()=> 'granted');
  const unsubscribe=vi.fn(async()=>true);
  const subscription={endpoint:payload.endpoint,toJSON:()=>payload,unsubscribe};
  const manager={getSubscription:vi.fn(async()=>null as typeof subscription|null),subscribe:vi.fn(async()=>subscription)};
  const registration={pushManager:manager};
  vi.stubGlobal('isSecureContext',true);
  vi.stubGlobal('Notification',{permission:'default',requestPermission:permission});
  vi.stubGlobal('PushManager',function(){});
  vi.stubGlobal('navigator',{serviceWorker:{register:vi.fn(async()=>registration),ready:Promise.resolve(registration)}});
  vi.stubGlobal('crypto',{subtle:{digest:vi.fn(async()=>new ArrayBuffer(32))}});
  useAuthStore().applyStatus(viewer);
  vi.mocked(requestJson).mockResolvedValueOnce({publicKey,enabled:false});
  const wrapper=mount(FamilyPushSettings);await flushPromises();
  expect(permission).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('Notifications are off on this device.');
  const button=(label:string)=>wrapper.findAll('button').find(b=>b.text()===label)!;
  vi.mocked(requestJson).mockResolvedValueOnce({enabled:true});
  await button('Enable notifications').trigger('click');await flushPromises();
  expect(permission).toHaveBeenCalledTimes(1);
  expect(manager.subscribe).toHaveBeenCalledWith({userVisibleOnly:true,applicationServerKey:expect.any(Uint8Array)});
  expect(requestJson).toHaveBeenLastCalledWith('/api/family/push',expect.objectContaining({method:'PUT',body:JSON.stringify(payload)}));
  expect(wrapper.text()).toContain('Notifications enabled on this device.');
  manager.getSubscription.mockResolvedValue(subscription);
  vi.mocked(requestJson).mockResolvedValueOnce({enabled:false});
  await button('Turn off notifications').trigger('click');await flushPromises();
  expect(requestJson).toHaveBeenLastCalledWith('/api/family/push?device='+'0'.repeat(64),{method:'DELETE'});
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain('Notifications are off on this device.');
 });
});