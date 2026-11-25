<template>
  <section v-if="allowed" class="card grid gap-4 p-6" data-test="publishing-studio">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="m-0 text-[1.18rem]">{{ t('publishing.title') }}</h2>
        <p class="m-0 mt-1 text-sm text-muted max-w-prose">{{ t('publishing.description') }}</p>
      </div>
      <button type="button" class="btn-primary" :aria-expanded="expanded" @click="expanded = !expanded">{{ t(expanded?'publishing.close':'publishing.open') }}</button>
    </div>
    <template v-if="expanded">
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="grid gap-1 text-sm font-medium">
          {{ t('publishing.album') }}
          <select v-model="folder" :aria-label="t('publishing.album')" class="rounded-lg border border-border bg-surface p-2 text-text" :disabled="busy">
            <option value="">{{ t('publishing.allAlbums') }}</option>
            <option v-for="album in albums" :key="album.slug" :value="album.slug">{{ album.name }}</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm font-medium">
          {{ t('publishing.status') }}
          <select v-model="filter" :aria-label="t('publishing.status')" class="rounded-lg border border-border bg-surface p-2 text-text" :disabled="busy">
            <option v-for="f in filters" :key="f" :value="f">{{ t('publishing.'+f) }}</option>
          </select>
        </label>
      </div>
      <section v-if="selectedAlbum" class="rounded-xl border border-border p-4 grid gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="m-0 text-base font-semibold">{{ t('publishing.importPolicy') }}</h3>
          <span class="text-xs text-muted">{{ selectedAlbum.name }}</span>
        </div>
        <label class="flex items-start gap-3 text-sm cursor-pointer">
          <input v-model="defaultDraft" :aria-label="t('publishing.defaultDraft')" type="checkbox" class="mt-0.5 h-5 w-5 accent-current shrink-0" :disabled="busy||loading" />
          <span>
            <span class="block font-medium">{{ t('publishing.defaultDraft') }}</span>
            <span class="block mt-1 text-xs text-muted">{{ t('publishing.defaultDraftHelp') }}</span>
          </span>
        </label>
        <div class="flex justify-end">
          <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm font-medium" :disabled="busy||loading||defaultDraft===selectedAlbum.defaultDraft" @click="saveImportPolicy">{{ t('publishing.saveImportPolicy') }}</button>
        </div>
      </section>
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p class="m-0 text-muted">{{ t('publishing.count',{count:total}) }}</p>
        <button type="button" class="rounded-lg border border-border px-3 py-2" :disabled="busy||loading||!items.length" @click="togglePage">{{ t(allSelected?'publishing.clearSelection':'publishing.selectPage') }}</button>
      </div>
      <p v-if="loading" class="m-0 text-sm text-muted">{{ t('publishing.loading') }}</p>
      <p v-else-if="!items.length" class="m-0 text-sm text-muted">{{ t('publishing.empty') }}</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        <label v-for="item in items" :key="item.id" class="grid gap-2 overflow-hidden rounded-xl border border-border p-2 cursor-pointer"
          :class="selected.includes(item.id)?'bg-surface-alt ring-1 ring-accent':'bg-surface'">
          <div class="relative aspect-square overflow-hidden rounded-lg bg-surface-alt">
            <img :src="item.thumbnailUrl" :alt="item.filename" loading="lazy" class="h-full w-full object-contain" />
            <input type="checkbox" class="absolute top-2 left-2 h-5 w-5 accent-current" :aria-label="item.filename" :checked="selected.includes(item.id)" :disabled="busy||loading" @change="toggle(item.id)" />
          </div>
          <p class="m-0 truncate text-xs font-medium" :title="item.filename">{{ item.filename }}</p>
          <p class="m-0 truncate text-xs text-muted">{{ item.folderName }}</p>
          <div class="flex flex-wrap gap-1 text-xs">
            <span class="rounded-full bg-surface-alt px-2 py-1 font-medium">{{ t('publishing.'+item.state) }}</span>
            <span v-if="item.featured" class="rounded-full bg-surface-alt px-2 py-1">{{ t('publishing.featured') }}</span>
          </div>
          <p v-if="item.takenAt" class="m-0 text-xs text-muted">{{ t('publishing.captured') }} {{ date(item.takenAt) }}</p>
          <p v-if="item.publishedAt" class="m-0 text-xs text-muted">{{ t(item.state==='scheduled'?'publishing.release':'publishing.publishedAt') }} {{ date(item.publishedAt) }}</p>
        </label>
      </div>
      <div class="flex items-center justify-between gap-2">
        <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm" :disabled="page===1||loading||busy" @click="page--">{{ t('publishing.previous') }}</button>
        <span class="text-sm text-muted">{{ t('publishing.page',{page}) }}</span>
        <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm" :disabled="!hasMore||loading||busy" @click="page++">{{ t('publishing.next') }}</button>
      </div>
      <form class="grid gap-3 rounded-xl border border-border bg-surface-alt p-4" @submit.prevent="confirm = true">
        <h3 class="m-0 text-base font-semibold">{{ t('publishing.actions') }}</h3>
        <label class="grid gap-1 text-sm font-medium">
          {{ t('publishing.target') }}
          <select v-model="target" class="rounded-lg border border-border bg-surface p-2 text-text" :disabled="busy">
            <option value="selected">{{ t('publishing.selected',{count:selected.length}) }}</option>
            <option value="album" :disabled="!folder">{{ t('publishing.entireAlbum') }}</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm font-medium">
          {{ t('publishing.action') }}
          <select v-model="action" :aria-label="t('publishing.action')" class="rounded-lg border border-border bg-surface p-2 text-text" :disabled="busy">
            <option v-for="a in actions" :key="a" :value="a">{{ t('publishing.'+a+'Action') }}</option>
          </select>
        </label>
        <label v-if="action==='schedule'" class="grid gap-1 text-sm font-medium">
          {{ t('publishing.releaseDate') }}
          <input v-model="when" type="datetime-local" required class="rounded-lg border border-border bg-surface p-2 text-text" />
          <span class="text-xs font-normal text-muted">{{ t('publishing.localTime') }}</span>
        </label>
        <p class="m-0 text-xs text-muted">{{ t('publishing.scopeHelp') }}</p>
        <p v-if="action==='draft'||action==='schedule'" class="m-0 text-xs text-muted">{{ t('publishing.privacyHelp') }}</p>
        <div v-if="confirm" class="grid gap-2 border border-border rounded-lg p-3">
          <p class="m-0 text-sm">{{ t('publishing.confirm',{action:t('publishing.'+action+'Action'),target:target==='album'?(albums.find(a=>a.slug===folder)?.name||folder):t('publishing.selected',{count:selected.length})}) }}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-primary" :disabled="!canApply" @click="apply">{{ t('publishing.apply') }}</button>
            <button type="button" class="rounded-lg border border-border px-3 py-2 text-sm" :disabled="busy" @click="confirm=false">{{ t('publishing.cancel') }}</button>
          </div>
        </div>
        <button v-else type="submit" class="btn-primary self-end" :disabled="!canApply">{{ t('publishing.review') }}</button>
      </form>
      <p v-if="error" class="m-0 text-sm text-red-500" role="alert">{{ error }}</p>
      <p v-if="success" class="m-0 text-sm" role="status">{{ success }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { requestJson } from '../api/http';
type Filter='all'|'draft'|'scheduled'|'published'|'featured';
type Action='draft'|'publish'|'schedule'|'feature'|'unfeature';
interface Item {id:number;filename:string;folderName:string;thumbnailUrl:string;takenAt:number|null;publishedAt:number|null;state:'draft'|'scheduled'|'published';featured:boolean}
interface Album {slug:string;name:string;defaultDraft:boolean}
interface Page {items:Item[];folders:Album[];total:number;hasMore:boolean}
const {t,locale}=useI18n();
const auth=useAuthStore();
const allowed=computed(()=>auth.ready&&auth.enabled&&auth.authenticated&&auth.role==='admin'&&!auth.externalFamilyAccess);
const expanded=ref(false), folder=ref(''),filter=ref<Filter>('all'),page=ref(1);
const items=ref<Item[]>([]),albums=ref<Album[]>([]),total=ref(0),hasMore=ref(false),selected=ref<number[]>([]);
const target=ref<'selected'|'album'>('selected'),action=ref<Action>('publish'),when=ref('');
const selectedAlbum=computed(()=>albums.value.find(a=>a.slug===folder.value));
const defaultDraft=ref(false);
watch(selectedAlbum,album=>{defaultDraft.value=album?.defaultDraft??false;});
const loading=ref(false),busy=ref(false),confirm=ref(false),error=ref(''),success=ref('');
const filters:Filter[]=['all','draft','scheduled','published','featured'];
const actions:Action[]=['publish','draft','schedule','feature','unfeature'];
const allSelected=computed(()=>items.value.length>0&&items.value.every(item=>selected.value.includes(item.id)));
const canApply=computed(()=>allowed.value&&!busy.value&&!loading.value&&(target.value==='album'?!!folder.value:selected.value.length>0)&&(action.value!=='schedule'||(Number.isFinite(Date.parse(when.value))&&Date.parse(when.value)>Date.now())));
let revision=0;
function date(value:number){return new Date(value).toLocaleString(locale.value,{dateStyle:'medium',timeStyle:'short'});}
function toggle(id:number){selected.value=selected.value.includes(id)?selected.value.filter(v=>v!==id):[...selected.value,id];}
function togglePage(){selected.value=allSelected.value?[]:items.value.map(item=>item.id);}
function clear(){revision++;items.value=[];albums.value=[];selected.value=[];total.value=0;hasMore.value=false;loading.value=false;busy.value=false;confirm.value=false;}
async function load(){
 if(!allowed.value||!expanded.value)return;
 const current=++revision;
 loading.value=true;items.value=[];total.value=0;hasMore.value=false;selected.value=[];confirm.value=false;error.value='';
 try{
   const query=new URLSearchParams({page:String(page.value),limit:'24',filter:filter.value});
   if(folder.value)query.set('folder',folder.value);
   const result=await requestJson<Page>('/api/admin/publications?'+query);
   if(current!==revision)return;
   if(!result.items.length&&result.total>0&&page.value>1){page.value--;return;}
   items.value=result.items;albums.value=result.folders;total.value=result.total;hasMore.value=result.hasMore;
 }catch(e){if(current===revision)error.value=e instanceof Error?e.message:t('publishing.error');}
 finally{if(current===revision)loading.value=false;}
}
watch([allowed,expanded],([valid,open])=>{if(valid&&open)void load();else clear();},{flush:'sync'});
watch([folder,filter],()=>{target.value='selected';if(page.value!==1)page.value=1;else void load();});
watch(page,()=>{void load();});
watch([target,action,when,selected],()=>{confirm.value=false;},{deep:true});
onBeforeUnmount(clear);
async function saveImportPolicy(){
 const album=selectedAlbum.value;
 if(!allowed.value||!album||busy.value||loading.value||defaultDraft.value===album.defaultDraft)return;
 const current=revision;
 const value=defaultDraft.value;
 busy.value=true;error.value='';success.value='';confirm.value=false;
 try{
   const result=await requestJson<{folder:string;defaultDraft:boolean}>('/api/admin/publications/import-policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:album.slug,defaultDraft:value})});
   if(current!==revision)return;
   albums.value=albums.value.map(a=>a.slug===result.folder?{...a,defaultDraft:result.defaultDraft}:a);
   success.value=t('publishing.importPolicySaved');
 }catch(e){if(current===revision)error.value=e instanceof Error?e.message:t('publishing.error');}
 finally{if(current===revision)busy.value=false;}
}
async function apply(){
 if(!canApply.value||!confirm.value)return;
 const current=revision;
 busy.value=true;error.value='';success.value='';
 const body={...(target.value==='album'?{folder:folder.value}:{ids:[...selected.value]}),action:action.value,...(action.value==='schedule'?{publishAt:Date.parse(when.value)}:{})};
 try{
   const result=await requestJson<{changed:number}>('/api/admin/publications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(current!==revision)return;
   success.value=t('publishing.updated',{count:result.changed});
   busy.value=false;confirm.value=false;
   await load();
 }catch(e){if(current===revision)error.value=e instanceof Error?e.message:t('publishing.error');}
 finally{if(current===revision)busy.value=false;}
}
</script>