<template>
  <main v-if="allowed" class="mx-auto w-full max-w-[48rem] min-w-0 px-3 sm:px-6 py-5 grid gap-4">
    <header class="flex flex-wrap justify-between items-start gap-3">
      <div class="grid gap-1">
        <RouterLink to="/" class="text-sm font-medium text-muted">{{ t('activity.back') }}</RouterLink>
        <h1 class="m-0 text-2xl font-semibold">{{ t('activity.title') }}</h1>
        <p class="m-0 text-sm text-muted">{{ t('activity.description') }}</p>
      </div>
      <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm font-medium" :disabled="loading||busy" @click="load(false)">{{ t('activity.refresh') }}</button>
    </header>
    <div class="flex flex-wrap justify-between items-center gap-3 border-b border-border pb-3">
      <div class="flex gap-1">
        <button v-for="f in filters" :key="f" type="button" :aria-pressed="filter===f" class="rounded-lg px-3 py-2 text-sm font-medium" :class="filter===f?'bg-surface-alt text-text':'text-muted'" @click="filter=f">{{ t('activity.'+f) }}<span v-if="f==='unread' && unread" class="ml-1">({{ unread }})</span></button>
      </div>
      <button type="button" class="text-sm font-semibold text-accent" :disabled="!unread||!snapshot||busy||loading" @click="mark({throughId:snapshot})">{{ t('activity.markAll') }}</button>
    </div>
    <p v-if="loading&&!items.length" role="status" class="m-0 text-sm text-muted">{{ t('activity.loading') }}</p>
    <div v-else-if="!items.length&&!error" class="rounded-xl border border-border bg-surface py-12 px-5 text-center grid gap-2">
      <span class="mx-auto i-fluent-heart-24-regular w-9 h-9 text-muted" aria-hidden="true" />
      <strong>{{ t(filter==='unread'?'activity.caughtUp':'activity.empty') }}</strong>
      <p class="m-0 text-sm text-muted">{{ t('activity.emptyHelp') }}</p>
    </div>
    <div v-else class="rounded-xl border border-border overflow-hidden divide-y divide-border">
      <article v-for="item in items" :key="item.id" class="flex items-start gap-3 p-3 sm:p-4" :class="!item.readAt?'bg-surface-alt':'bg-surface'">
        <div class="mt-1 w-8 h-8 rounded-full bg-surface flex items-center justify-center shrink-0">
          <span :class="item.kind==='like'?'i-fluent-heart-24-filled text-red-500':'i-fluent-chat-24-regular text-muted'" class="w-5 h-5" aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1 grid gap-1">
          <p class="m-0 text-sm break-words"><strong>{{ item.memberName || t('activity.unknownMember') }}</strong> {{ t(item.kind==='like'?'activity.liked':'activity.commented') }}</p>
          <p v-if="item.body" class="m-0 text-sm whitespace-pre-wrap break-words">{{ item.body }}</p>
          <p class="m-0 text-xs text-muted">{{ item.folderName }} · {{ formatDate(item.createdAt) }}</p>
          <RouterLink :to="{name:'image',params:{id:item.postId}}" class="text-sm font-semibold text-accent self-start" @click="open(item)">{{ t('activity.viewPhoto') }}</RouterLink>
          <button v-if="!item.readAt" type="button" class="text-xs font-medium text-muted self-start text-start" :disabled="busy" @click="mark({id:item.id})">{{ t('activity.markRead') }}</button>
        </div>
        <RouterLink :to="{name:'image',params:{id:item.postId}}" :aria-label="t('activity.viewPhoto')" @click="open(item)" class="shrink-0 block w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-surface-alt">
          <img :src="item.thumbnailUrl" :alt="item.filename" class="w-full h-full object-contain" loading="lazy" />
        </RouterLink>
      </article>
    </div>
    <button v-if="nextBeforeId" type="button" class="rounded-lg border border-border py-3 text-sm font-semibold" :disabled="loading||busy" @click="load(true)">{{ t('activity.older') }}</button>
    <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ error }}</p>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { requestJson } from '../api/http';
import { useAuthStore } from '../stores/auth';
interface Item {id:number;postId:number;kind:'like'|'comment';createdAt:number;readAt:number|null;memberName:string|null;body:string|null;filename:string;folderName:string;thumbnailUrl:string}
interface Page {items:Item[];unread:number;snapshot:number;nextBeforeId:number|null}
type Target={id:number}|{throughId:number};
const {t,locale}=useI18n();
const auth=useAuthStore();
const allowed=computed(()=>auth.ready&&auth.enabled&&auth.authenticated&&auth.role==='admin'&&auth.accessMode!=='public'&&!auth.externalFamilyAccess);
const filters=['all','unread'] as const;
const filter=ref<'all'|'unread'>('all');
const items=ref<Item[]>([]),unread=ref(0),snapshot=ref(0),nextBeforeId=ref<number|null>(null);
const loading=ref(false),busy=ref(false),error=ref('');
let revision=0;
function formatDate(value:number){return new Date(value).toLocaleString(locale.value,{dateStyle:'medium',timeStyle:'short'});}
function reset(){revision++;items.value=[];unread.value=0;snapshot.value=0;nextBeforeId.value=null;loading.value=false;busy.value=false;error.value='';}
async function load(older:boolean){
 if(!allowed.value||busy.value||(older&&(loading.value||nextBeforeId.value===null)))return;
 const current=++revision;
 loading.value=true;error.value='';
 try{
  const q=new URLSearchParams({limit:'30',filter:filter.value});
  if(older)q.set('beforeId',String(nextBeforeId.value));
  const result=await requestJson<Page>('/api/admin/activity?'+q);
  if(current!==revision||!allowed.value)return;
  items.value=older?[...items.value,...result.items.filter(item=>!items.value.some(v=>v.id===item.id))]:result.items;
  unread.value=result.unread;nextBeforeId.value=result.nextBeforeId;
  if(!older)snapshot.value=result.snapshot;
 }catch{if(current===revision)error.value=t('activity.error');}
 finally{if(current===revision)loading.value=false;}
}
watch([allowed,filter],([valid])=>{reset();if(valid)void load(false);},{immediate:true,flush:'sync'});
onBeforeUnmount(reset);
async function mark(target:Target){
 if(!allowed.value||busy.value||loading.value)return;
 const current=revision;
 busy.value=true;error.value='';
 try{
  const result=await requestJson<{changed:number;unread:number}>('/api/admin/activity/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target)});
  if(current!==revision||!allowed.value)return;
  unread.value=result.unread;
  const match=(item:Item)=>'id' in target?item.id===target.id:item.id<=target.throughId;
  if(filter.value==='unread')items.value=items.value.filter(item=>!match(item));
  else items.value=items.value.map(item=>match(item)?{...item,readAt:item.readAt??Date.now()}:item);
 }catch{if(current===revision)error.value=t('activity.error');}
 finally{if(current===revision)busy.value=false;}
}
function open(item:Item){if(!item.readAt)void mark({id:item.id});}
</script>