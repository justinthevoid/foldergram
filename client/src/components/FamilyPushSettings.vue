<template>
 <section v-if="allowed" class="rounded-xl border border-border bg-surface p-3 sm:p-4 grid gap-3" data-test="family-push">
  <div class="flex items-start gap-3">
   <span class="i-fluent-alert-24-regular w-5 h-5 shrink-0 mt-0.5 text-muted" aria-hidden="true" />
   <div class="min-w-0 flex-1 grid gap-1">
    <h2 class="m-0 text-sm font-semibold">{{ t('push.title') }}</h2>
    <p class="m-0 text-xs text-muted">{{ t('push.description') }}</p>
    <p v-if="!supported" class="m-0 text-xs text-muted">{{ t('push.unavailable') }} {{ t('push.installHelp') }}</p>
    <p v-else-if="preparing" class="m-0 text-xs text-muted" role="status">{{ t('push.preparing') }}</p>
    <p v-else class="m-0 text-xs text-muted" role="status">{{ t(enabled?'push.on':permission==='denied'?'push.denied':'push.off') }}</p>
   </div>
  </div>
  <div v-if="supported&&!preparing" class="flex flex-wrap justify-end gap-2">
   <button v-if="!available" type="button" class="rounded-lg border border-border min-h-11 px-3 py-2 text-xs font-medium" :disabled="busy" @click="prepare">{{ t('push.refresh') }}</button>
   <button v-else-if="enabled" type="button" class="rounded-lg border border-border min-h-11 px-3 py-2 text-xs font-medium" :disabled="busy" @click="disable">{{ t('push.disable') }}</button>
   <button v-else type="button" class="btn-primary min-h-11 text-xs" :disabled="busy||permission==='denied'" @click="enable">{{ t('push.enable') }}</button>
  </div>
  <p v-if="error" role="alert" class="m-0 text-xs text-red-500">{{ error }}</p>
 </section>
</template>
<script setup lang="ts">
import {computed,ref,onMounted,onBeforeUnmount,watch} from 'vue';
import {useI18n} from 'vue-i18n';
import {useAuthStore} from '../stores/auth';
import {requestJson} from '../api/http';
const {t}=useI18n();
const auth=useAuthStore();
const allowed=computed(()=>auth.ready&&auth.authenticated&&auth.role==='viewer'&&!!auth.familyMember&&auth.externalFamilyAccess);
const supported=typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&!!window.crypto?.subtle;
const enabled=ref(false),available=ref(false),preparing=ref(false),busy=ref(false),error=ref('');
const permission=ref<NotificationPermission>(supported?Notification.permission:'default');
let registration:ServiceWorkerRegistration|undefined;
let key:Uint8Array<ArrayBuffer>|undefined;
let revision=0;
async function hash(endpoint:string){
 const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint));
 return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
}
function clear(){revision++;registration=undefined;key=undefined;available.value=false;enabled.value=false;busy.value=false;preparing.value=false;error.value='';}
async function prepare(){
 if(!allowed.value||!supported||busy.value||preparing.value)return;
 const current=++revision;
 preparing.value=true;available.value=false;error.value='';permission.value=Notification.permission;
 try{
  registration=await navigator.serviceWorker.register('/sw.js');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = await Promise.race([
   navigator.serviceWorker.ready,
   new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Notification setup timed out')), 8000); })
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  if(current!==revision||!allowed.value)return;
  registration=active;
  const subscription=await active.pushManager.getSubscription();
  const q=subscription?'?device='+await hash(subscription.endpoint):'';
  const result=await requestJson<{publicKey:string;enabled:boolean}>('/api/family/push'+q);
  if(current!==revision||!allowed.value)return;
  const base64=result.publicKey.replace(/-/g,'+').replace(/_/g,'/')+'=';
  const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));
  if(bytes.length!==65)throw Error('Invalid notification key');
  key=bytes;enabled.value=!!subscription&&result.enabled;available.value=true;
 }catch{if(current===revision)error.value=t('push.failed');}
 finally{if(current===revision)preparing.value=false;}
}
watch(allowed,valid=>{if(valid)void prepare();else clear();},{immediate:true,flush:'sync'});
onMounted(()=>window.addEventListener('focus',prepare));
onBeforeUnmount(()=>{clear();window.removeEventListener('focus',prepare);});
async function enable(){
 if(!allowed.value||!registration||!key||busy.value||!available.value)return;
 const current=revision,reg=registration,publicKey=key;
 busy.value=true;error.value='';
 let created:PushSubscription|null=null;
 try{
  // The permission request happens synchronously from the click handler.
  permission.value=await Notification.requestPermission();
  if(permission.value!=='granted'||current!==revision||!allowed.value)return;
  let subscription=await reg.pushManager.getSubscription();
  if(!subscription){
   subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
   created=subscription;
  }
  if(current!==revision||!allowed.value){if(created)await created.unsubscribe();return;}
  const payload=subscription.toJSON();
  await requestJson('/api/family/push',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(current===revision&&allowed.value)enabled.value=true;
 }catch{
  if(created)await created.unsubscribe().catch(()=>false);
  if(current===revision)error.value=t('push.failed');
 }finally{if(current===revision)busy.value=false;}
}
async function disable(){
 if(!allowed.value||!registration||busy.value)return;
 const current=revision,reg=registration;
 busy.value=true;error.value='';
 try{
  const subscription=await reg.pushManager.getSubscription();
  if(subscription){
   await requestJson('/api/family/push?device='+await hash(subscription.endpoint),{method:'DELETE'});
   enabled.value=false;
   await subscription.unsubscribe();
  }
  if(current===revision)enabled.value=false;
 }catch{if(current===revision)error.value=t('push.failed');}
 finally{if(current===revision)busy.value=false;}
}
</script>