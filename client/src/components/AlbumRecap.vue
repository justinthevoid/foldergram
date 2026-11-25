<template>
  <dialog ref="dialog" class="album-recap" :aria-labelledby="headingId" @cancel.prevent="emit('close')">
    <header class="album-recap__toolbar">
      <span class="album-recap__eyebrow">{{ t('albumRecap.title') }}</span>
      <button type="button" class="btn-ghost" autofocus @click="emit('close')">{{ t('common.close') }}</button>
    </header>

    <div class="album-recap__scroll">
      <article class="album-recap__article">
        <header class="album-recap__intro">
          <h2 :id="headingId">{{ albumName }}</h2>
          <p v-if="description" class="album-recap__description">{{ description }}</p>
          <p class="album-recap__subheading">{{ t('albumRecap.subtitle') }}</p>
        </header>

        <div v-if="visiblePhotos.length" class="album-recap__grid">
          <figure v-for="(photo, index) in visiblePhotos" :key="photo.key"
            class="album-recap__figure" :class="{ 'album-recap__figure--wide': index % 5 === 0 }">
            <div class="album-recap__frame" :style="{ aspectRatio: recapAspectRatio(photo) }">
              <ResilientImage :src="photo.previewUrl" :fallback-src="photo.thumbnailUrl" :alt="photo.filename"
                :width="photo.width" :height="photo.height" :loading="index === 0 ? 'eager' : 'lazy'"
                :fetch-priority="index === 0 ? 'high' : 'auto'" :max-retries="2" show-retry />
            </div>
            <figcaption v-if="photo.caption || photo.takenAt !== null">
              <time v-if="photo.takenAt !== null" :datetime="new Date(photo.takenAt).toISOString()">{{ formatDate(photo.takenAt) }}</time>
              <p v-if="photo.caption">{{ photo.caption }}</p>
            </figcaption>
          </figure>
        </div>
        <div class="album-recap__end">
          <p v-if="loading" role="status">{{ t('common.loadingMore') }}</p>
          <p v-else-if="pageError" role="alert">{{ t('albumRecap.loadError') }}</p>
          <p v-else-if="!photos.length && !hasMore">{{ t('albumRecap.empty') }}</p>
          <p v-else-if="photos.length && !canReveal && !hasMore">{{ t('albumRecap.end') }}</p>
          <button v-if="canReveal || hasMore" type="button" class="btn-ghost" :disabled="loading" @click="revealMore">
            {{ t(!canReveal && pageError ? 'common.retry' : 'common.loadMore') }}
          </button>
        </div>
      </article>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FeedItem } from '../types/api';
import { getRecapPhotos, recapAspectRatio } from '../utils/album-recap';
import ResilientImage from './ResilientImage.vue';

const props = defineProps<{
  albumName: string;
  description?: string | null;
  items: FeedItem[];
  hasMore: boolean;
  loading: boolean;
  pageError?: string | null;
}>();
const emit = defineEmits<{ close: []; loadMore: [] }>();
const { t, locale } = useI18n();
const headingId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const BATCH = 12;
const visibleCount = ref(BATCH);
const photos = computed(() => getRecapPhotos(props.items));
const visiblePhotos = computed(() => photos.value.slice(0, visibleCount.value));
const canReveal = computed(() => visibleCount.value < photos.value.length);
function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(timestamp);
}
function revealMore() {
  if (props.loading) return;
  if (canReveal.value) visibleCount.value += BATCH;
  else if (props.hasMore) {
    visibleCount.value = photos.value.length + BATCH;
    emit('loadMore');
  }
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close(); });
</script>

<style scoped>
.album-recap { position: fixed; inset: 0; box-sizing: border-box; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: var(--bg); color: var(--text); overflow: hidden; }
.album-recap[open] { display: flex; flex-direction: column; }
.album-recap::backdrop { background: var(--bg); }
.album-recap__toolbar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: max(8px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 8px max(20px, env(safe-area-inset-left)); background: var(--surface); border-bottom: 1px solid var(--border); }
.album-recap__toolbar button, .album-recap__end button { min-height: 44px; }
.album-recap__eyebrow { color: var(--muted); font-size: .78rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
.album-recap__scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.album-recap__article { width: min(100% - 40px, 850px); margin: 0 auto; padding: clamp(30px, 6vw, 70px) 0 max(44px, env(safe-area-inset-bottom)); }
.album-recap__intro { margin: 0 auto clamp(24px, 5vw, 48px); text-align: center; max-width: 660px; }
.album-recap__intro h2 { margin: 0; font-size: clamp(2rem, 6vw, 3.6rem); line-height: 1.08; letter-spacing: -.045em; font-weight: 650; overflow-wrap: anywhere; }
.album-recap__description { margin: 16px auto 0; max-width: 580px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; font-size: 1rem; }
.album-recap__subheading { margin: 12px 0 0; color: var(--muted); font-size: .9rem; }
.album-recap__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: clamp(20px, 4vw, 40px) clamp(14px, 3vw, 28px); align-items: start; }
.album-recap__figure { min-width: 0; margin: 0; }
.album-recap__figure--wide { grid-column: 1 / -1; }
.album-recap__frame { display: grid; place-items: center; overflow: hidden; background: var(--surface-alt); border-radius: 6px; width: 100%; max-height: 70vh; }
.album-recap__frame img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
.album-recap__figure figcaption { padding-top: 10px; display: grid; gap: 5px; }
.album-recap__figure time { color: var(--muted); font-size: .76rem; font-weight: 550; }
.album-recap__figure figcaption p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .92rem; line-height: 1.6; }
.album-recap__end { display: grid; justify-items: center; gap: 12px; padding: 32px 0 0; color: var(--muted); text-align: center; font-size: .9rem; }
.album-recap__end p { margin: 0; }
@media (max-width: 560px) {
  .album-recap__article { width: calc(100% - 28px); }
  .album-recap__grid { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .album-recap__toolbar { padding-inline: 14px; }
}
</style>
