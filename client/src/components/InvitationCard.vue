<template>
  <section class="grid gap-4 rounded-xl border border-border bg-surface p-4" data-test="invitation-card">
    <header>
      <h3 class="m-0 font-semibold text-lg">{{ t('inviteCard.title') }}</h3>
      <p class="m-0 mt-1 text-sm text-muted">{{ t('inviteCard.description') }}</p>
    </header>
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
      <div class="min-w-0 grid justify-items-center gap-2">
        <canvas ref="canvas" width="1200" height="1800" role="img" :aria-label="t('inviteCard.preview')" class="block w-full max-w-[320px] rounded-md shadow-lg aspect-[2/3]" />
        <p class="m-0 text-xs text-muted">{{ t('inviteCard.size') }}</p>
        <p v-if="theme === 'mosaic' && verified" class="m-0 text-xs text-muted">{{ t(inset ? 'inviteCard.artVerified' : 'inviteCard.verified') }}</p>
      </div>
      <div class="grid min-w-0 gap-3">
        <label class="grid gap-1 text-sm font-medium">
          {{ t('inviteCard.style') }}
          <select v-model="theme" :aria-label="t('inviteCard.style')" class="rounded-lg border border-border p-2 bg-surface text-text">
            <option value="mosaic">{{ t('inviteCard.mosaic') }}</option>
            <option value="paper">{{ t('inviteCard.paper') }}</option>
            <option value="film">{{ t('inviteCard.film') }}</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm font-medium">
          {{ t('inviteCard.headline') }}
          <textarea v-model="headline" maxlength="70" rows="2" class="rounded-lg border border-border p-2 bg-surface text-text resize-y" />
        </label>
        <label class="grid gap-1 text-sm font-medium">
          {{ t('inviteCard.message') }}
          <textarea v-model="message" maxlength="140" rows="3" class="rounded-lg border border-border p-2 bg-surface text-text resize-y" />
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="rounded-lg border border-border px-3 py-2 font-medium text-sm" @click="togglePicker">
            <span class="i-fluent-image-20-regular inline-block w-4 h-4 align-middle mr-1" aria-hidden="true" />
            {{ t(picker ? 'inviteCard.hidePhotos' : 'inviteCard.choosePhoto') }}
          </button>
          <button v-if="selectedPhoto" type="button" class="text-sm text-muted" @click="clearPhoto">{{ t('inviteCard.removePhoto') }}</button>
        </div>
        <p v-if="photoLoading" class="m-0 text-sm text-muted">{{ t('inviteCard.loading') }}</p>
        <div v-if="picker" class="grid gap-2 rounded-lg border border-border p-3">
          <label class="grid gap-1 text-sm">
            {{ t('inviteCard.album') }}
            <select v-model="album" :aria-label="t('inviteCard.album')" class="rounded-lg border border-border p-2 bg-surface text-text">
              <option value="">{{ t('inviteCard.recent') }}</option>
              <option v-for="folder in folders" :key="folder.slug" :value="folder.slug">{{ folder.name }}</option>
            </select>
          </label>
          <div class="grid grid-cols-3 gap-1.5">
            <button v-for="item in photos" :key="item.id" type="button" :title="item.filename" :aria-label="item.filename"
              :aria-pressed="selectedPhoto?.id === item.id" :disabled="photoLoading"
              class="aspect-square overflow-hidden rounded-md border border-border bg-surface-alt hover:border-accent focus-visible:outline-accent"
              @click="choosePhoto(item)">
              <img v-if="thumbnail(item)" :src="thumbnail(item)!" :alt="item.filename" loading="lazy" class="w-full h-full object-cover" />
            </button>
          </div>
          <p v-if="!photos.length && !loadingPhotos" class="m-0 text-sm text-muted">{{ t('inviteCard.noPhotos') }}</p>
          <button v-if="more" type="button" class="rounded-lg border border-border px-3 py-2 text-sm" :disabled="loadingPhotos" @click="loadPhotos(false)">{{ t(loadingPhotos ? 'inviteCard.loading' : 'inviteCard.more') }}</button>
          <p v-else-if="loadingPhotos" class="m-0 text-sm text-muted">{{ t('inviteCard.loading') }}</p>
        </div>
        <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ error }}</p>
        <p v-if="expired" role="alert" class="m-0 text-sm text-red-500">{{ t('inviteCard.expired') }}</p>
        <div class="flex flex-wrap gap-2 pt-1">
          <button type="button" class="btn-primary" :disabled="!ready || expired || photoLoading" @click="download">{{ t('inviteCard.download') }}</button>
          <button type="button" class="rounded-lg border border-border px-3 py-2 font-medium text-sm" :disabled="!ready || expired || photoLoading" @click="print">{{ t('inviteCard.print') }}</button>
        </div>
        <p class="m-0 text-xs leading-relaxed text-muted">{{ t('inviteCard.privateNotice') }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestJson } from '../api/http';
import { useBrandingStore } from '../stores/branding';
import type { FeedItem, FolderSummary } from '../types/api';
import { localPhotoUrl, renderInvitationCard, type CardTheme } from '../utils/invitation-card';
import mountainArtUrl from '../assets/invitation-mountain-art.webp';

const props = defineProps<{ link: string; recipient: string; expiresAt: number }>();
const { t, locale } = useI18n();
const branding = useBrandingStore();
const canvas = ref<HTMLCanvasElement|null>(null);
const theme = ref<CardTheme>('mosaic');
const artwork = shallowRef<HTMLImageElement|null>(null);
const verified = ref(false);
const inset = ref(false);
const headline = ref(t('inviteCard.defaultHeadline'));
const message = ref(t('inviteCard.defaultMessage'));
const ready = ref(false);
const error = ref('');
const now = ref(Date.now());
const expired = computed(() => now.value >= props.expiresAt);
const picker = ref(false);
const album = ref('');
const folders = ref<FolderSummary[]>([]);
const photos = ref<FeedItem[]>([]);
const page = ref(0);
const more = ref(false);
const loadingPhotos = ref(false);
const selectedPhoto = ref<FeedItem|null>(null);
const photo = shallowRef<HTMLImageElement|null>(null);
const photoLoading = ref(false);
let alive = true;
let listRevision = 0;
let photoRevision = 0;
let clock: ReturnType<typeof setInterval>|undefined;

function draw() {
  if (!canvas.value || !alive) return;
  ready.value = false;
  if (expired.value) {
    canvas.value.getContext('2d')?.clearRect(0,0,canvas.value.width,canvas.value.height);
    return;
  }
  try {
    const result = renderInvitationCard(canvas.value, {
      link: props.link, theme: theme.value, galleryName: branding.value.name,
      recipient: t('inviteCard.forRecipient', { name: props.recipient }),
      headline: headline.value, message: message.value,
      action: t('inviteCard.scan'), instruction: t('inviteCard.instructions'),
      expires: t('inviteCard.expires', { date: new Date(props.expiresAt).toLocaleDateString(locale.value, { year:'numeric', month:'short', day:'numeric' }) }),
      photo: photo.value,
      artwork: artwork.value
    });
    verified.value = result?.verified ?? false;
    inset.value = result?.artworkInset ?? false;
    ready.value = true;
  } catch { error.value = t('inviteCard.renderError'); }
}
watch(() => [props.link, props.recipient, props.expiresAt, theme.value, headline.value, message.value, photo.value, artwork.value, branding.value.name, locale.value, expired.value], draw, { flush: 'post' });
onMounted(() => {
  const image=new Image();
  image.onload=()=>{if(alive)artwork.value=image;};
  image.onerror=()=>{if(alive)draw();};
  image.src=mountainArtUrl;
  draw();
  clock=setInterval(()=>{now.value=Date.now();},15000);
});
onBeforeUnmount(() => {
  alive=false; listRevision++; photoRevision++;
  if(clock) clearInterval(clock);
  canvas.value?.getContext('2d')?.clearRect(0,0,1200,1800);
});

function thumbnail(item: FeedItem) { return localPhotoUrl(item.thumbnailUrl,window.location.origin); }
async function togglePicker() {
  picker.value = !picker.value;
  if(!picker.value) return;
  if(!folders.value.length) {
    try {
      const result = await requestJson<{items:FolderSummary[]}>('/api/folders');
      if(alive) folders.value = result.items;
    } catch { if(alive) error.value=t('inviteCard.photoError'); }
  }
  if(alive && !photos.value.length) await loadPhotos(true);
}
watch(album, () => { if(picker.value) void loadPhotos(true); });
async function loadPhotos(reset: boolean) {
  if(!reset && loadingPhotos.value) return;
  const revision=++listRevision;
  const currentAlbum=album.value;
  const next=reset?1:page.value+1;
  loadingPhotos.value=true; error.value='';
  if(reset){photos.value=[];page.value=0;more.value=false;}
  try {
    const path=currentAlbum
      ? '/api/folders/'+encodeURIComponent(currentAlbum)+'/images?page='+next+'&limit=24&mediaType=image'
      : '/api/feed?page='+next+'&limit=24&mode=recent';
    const result=await requestJson<{items:FeedItem[];hasMore:boolean}>(path);
    if(!alive || revision!==listRevision) return;
    const fresh=result.items.filter(item=>item.mediaType==='image' && !!thumbnail(item));
    photos.value=[...photos.value,...fresh.filter(item=>!photos.value.some(existing=>existing.id===item.id))];
    page.value=next;more.value=result.hasMore;
  } catch { if(alive && revision===listRevision) error.value=t('inviteCard.photoError'); }
  finally { if(alive && revision===listRevision) loadingPhotos.value=false; }
}
async function choosePhoto(item: FeedItem) {
  const url=localPhotoUrl(item.previewUrl,window.location.origin) ?? thumbnail(item);
  if(!url) return;
  const revision=++photoRevision;
  photoLoading.value=true;error.value='';
  let objectUrl:string|undefined;
  try {
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error'});
    if(!response.ok) throw new Error('Photo unavailable');
    const blob=await response.blob();
    if(!blob.type.startsWith('image/')||blob.size>20*1024*1024) throw new Error('Invalid photo');
    objectUrl=URL.createObjectURL(blob);
    const image=new Image();
    image.src=objectUrl;
    await image.decode();
    if(!alive||revision!==photoRevision) return;
    photo.value=image;selectedPhoto.value=item;picker.value=false;
  } catch { if(alive&&revision===photoRevision) error.value=t('inviteCard.photoError'); }
  finally { if(objectUrl) URL.revokeObjectURL(objectUrl);if(alive&&revision===photoRevision) photoLoading.value=false; }
}
function clearPhoto(){photoRevision++;photoLoading.value=false;photo.value=null;selectedPhoto.value=null;}
function canExport(){now.value=Date.now();return !!canvas.value&&ready.value&&!expired.value&&!photoLoading.value;}
function download(){
  if(!canExport()) return;
  const revision=photoRevision;
  const link=props.link;
  canvas.value!.toBlob(blob=>{
    if(!blob||!alive||revision!==photoRevision||link!==props.link||Date.now()>=props.expiresAt) return;
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='family-invitation.png';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  },'image/png');
}
function print(){
  if(!canExport()) return;
  const popup=window.open('','_blank','popup');
  if(!popup){error.value=t('inviteCard.printError');return;}
  popup.opener=null;
  const doc=popup.document;
  doc.title=t('inviteCard.title');
  const css=doc.createElement('style');
  css.textContent='@page{size:4in 6in;margin:0}body{margin:0;background:white;display:grid;place-items:center;min-height:100vh}img{width:4in;height:6in;object-fit:contain;max-width:100%;display:block}@media print{body{min-height:0;display:block}img{width:4in;height:6in;max-width:none}}';
  doc.head.append(css);
  const image=doc.createElement('img'); image.alt=t('inviteCard.preview');
  image.onload=()=>{popup.focus();popup.print();};
  popup.onafterprint=()=>popup.close();
  image.src=canvas.value!.toDataURL('image/png'); doc.body.append(image);
}
</script>