<template>
  <dialog ref="dialog" class="living-room" :aria-labelledby="headingId" @cancel.prevent="close" @keydown="handleKeydown">
    <div ref="surface" class="living-room__surface">
      <header class="living-room__header">
        <div class="living-room__title">
          <span>{{ t('slideshow.title') }}</span>
          <h2 :id="headingId">{{ albumName }}</h2>
        </div>
        <button type="button" autofocus @click="close">{{ t('slideshow.close') }}</button>
      </header>

      <div class="living-room__stage">
        <ProgressivePhoto v-if="current" :key="current.key" :src="current.previewUrl"
          :thumbnail-src="current.thumbnailUrl" :alt="current.filename" :width="current.width" :height="current.height" />
        <div v-else class="living-room__message">
          <p v-if="loading" role="status">{{ t('common.loadingMore') }}</p>
          <template v-else-if="loadError">
            <p role="alert">{{ t('slideshow.loadError') }}</p>
            <button type="button" @click="advance">{{ t('common.retry') }}</button>
          </template>
          <button v-else-if="hasMore" type="button" @click="advance">{{ t('common.loadMore') }}</button>
          <p v-else>{{ t('slideshow.empty') }}</p>
        </div>
      </div>

      <footer class="living-room__footer">
        <div class="living-room__status">
          <span v-if="current">{{ t('slideshow.position', { current: index + 1 }) }}</span>
          <span v-if="current && loading" role="status">{{ t('common.loadingMore') }}</span>
          <span v-else-if="current && loadError" role="alert">{{ t('slideshow.loadError') }}</span>
        </div>
        <div v-if="current" class="living-room__controls">
          <button type="button" :disabled="loading || (index === 0 && (hasMore || slides.length < 2))"
            @click="previous">{{ t('slideshow.previous') }}</button>
          <button type="button" :disabled="slides.length < 2 && !hasMore" @click="playing = !playing">
            {{ t(playing ? 'slideshow.pause' : 'slideshow.play') }}
          </button>
          <button type="button" :disabled="loading || (slides.length < 2 && !hasMore)"
            @click="advance">{{ t(loadError ? 'common.retry' : 'slideshow.next') }}</button>
        </div>
        <button v-if="fullscreenAvailable" type="button" @click="toggleFullscreen">
          {{ t(fullscreenActive ? 'slideshow.exitFullscreen' : 'slideshow.fullscreen') }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchFolderImages } from '../api/gallery';
import ProgressivePhoto from './ProgressivePhoto.vue';
import { getPostPhotos } from '../utils/post-photos';

const props = defineProps<{ slug: string; albumName: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const headingId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const surface = ref<HTMLElement | null>(null);
type Slide = { key: string; filename: string; previewUrl: string; thumbnailUrl: string; width: number; height: number };
const slides = ref<Slide[]>([]);
const index = ref(0);
const current = computed(() => slides.value[index.value] ?? null);
const hasMore = ref(true);
const loading = ref(false);
const loadError = ref(false);
const playing = ref(true);
const fullscreenAvailable = ref(false);
const fullscreenActive = ref(false);
const DISPLAY_MS = 8000;
let page = 1;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const seen = new Set<string>();

async function loadNextPage() {
  if (loading.value || !hasMore.value) return false;
  const requestGeneration = generation;
  loading.value = true;
  loadError.value = false;
  try {
    const result = await fetchFolderImages(props.slug, page, 24, 'image');
    if (requestGeneration !== generation) return false;
    for (const post of result.items) {
      for (const photo of getPostPhotos(post)) {
        if (seen.has(photo.key)) continue;
        seen.add(photo.key);
        slides.value.push(photo);
      }
    }
    page = result.page + 1;
    hasMore.value = result.hasMore;
    return true;
  } catch {
    if (requestGeneration === generation) {
      loadError.value = true;
      playing.value = false;
    }
    return false;
  } finally {
    if (requestGeneration === generation) loading.value = false;
  }
}

async function advance() {
  if (loading.value) return;
  const requestGeneration = generation;
  const target = current.value ? index.value + 1 : 0;
  // A mixed carousel may have no eligible photos; bound work per action.
  for (let attempts = 0; target >= slides.value.length && hasMore.value && attempts < 3; attempts++) {
    if (!await loadNextPage() || requestGeneration !== generation) return;
  }
  if (requestGeneration !== generation) return;
  if (target < slides.value.length) index.value = target;
  else if (!hasMore.value) index.value = 0;
  schedule();
}

function previous() {
  if (loading.value || !slides.value.length) return;
  if (index.value > 0) index.value--;
  else if (!hasMore.value) index.value = slides.value.length - 1;
  schedule();
}

function clearTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
function schedule() {
  clearTimer();
  if (playing.value && current.value && !loading.value && !loadError.value && !document.hidden &&
      (slides.value.length > 1 || hasMore.value)) {
    timer = setTimeout(() => { void advance(); }, DISPLAY_MS);
  }
}
function handleKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); void advance(); }
}
function syncFullscreen() {
  fullscreenActive.value = !!surface.value && document.fullscreenElement === surface.value;
}
async function toggleFullscreen() {
  try {
    if (fullscreenActive.value) await document.exitFullscreen();
    else await surface.value?.requestFullscreen();
  } catch { /* The viewport-sized dialog remains available if fullscreen is blocked. */ }
}
function close() { emit('close'); }

watch([playing, index, loading, hasMore, loadError, () => slides.value.length], schedule, { flush: 'post' });
watch(() => props.slug, () => { generation++; close(); });
onMounted(() => {
  dialog.value?.showModal();
  fullscreenAvailable.value = !!document.fullscreenEnabled && typeof surface.value?.requestFullscreen === 'function';
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('visibilitychange', schedule);
  void advance();
});
onBeforeUnmount(() => {
  generation++;
  clearTimer();
  document.removeEventListener('fullscreenchange', syncFullscreen);
  document.removeEventListener('visibilitychange', schedule);
  if (fullscreenActive.value) void document.exitFullscreen().catch(() => {});
  if (dialog.value?.open) dialog.value.close();
});
</script>

<style scoped>
.living-room { position: fixed; inset: 0; margin: 0; width: 100%; height: 100%; max-width: none; max-height: none; border: 0; padding: 0; background: #0b0b0d; color: #fafafa; overflow: hidden; }
.living-room::backdrop { background: #0b0b0d; }
.living-room__surface { box-sizing: border-box; height: 100%; width: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: #0b0b0d; color: #fafafa; padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
.living-room__header, .living-room__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.living-room__header { padding-bottom: 12px; }
.living-room__footer { padding-top: 12px; }
.living-room__title { min-width: 0; flex: 1; }
.living-room__title span, .living-room__status { font-size: .8rem; color: #c4c4ca; }
.living-room__title h2 { font-size: clamp(1rem, 2.5vw, 1.5rem); font-weight: 600; margin: 2px 0 0; overflow-wrap: anywhere; }
.living-room__stage { position: relative; min-height: 0; min-width: 0; overflow: hidden; display: grid; place-items: center; }
.living-room__message { text-align: center; color: #c4c4ca; }
.living-room__status { display: flex; gap: 8px; flex-wrap: wrap; }
.living-room__controls { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; }
.living-room button { min-height: 44px; padding: 8px 14px; border-radius: 10px; border: 1px solid #54545d; color: #fafafa; background: #25252b; font-weight: 550; cursor: pointer; }
.living-room button:hover:not(:disabled) { background: #3b3b43; }
.living-room button:disabled { opacity: .45; cursor: default; }
.living-room button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
@media (max-width: 560px) {
  .living-room__footer { justify-content: center; }
  .living-room__status { flex-basis: 100%; justify-content: center; }
}
</style>
