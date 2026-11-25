<template>
  <dialog ref="dialog" class="album-cover-picker" :aria-labelledby="headingId"
    @cancel.prevent="cancel" @click="handleBackdrop">
    <header class="album-cover-picker__header">
      <h2 :id="headingId">{{ t('albumCover.choose') }}</h2>
      <p>{{ t('albumCover.description') }}</p>
    </header>
    <div class="album-cover-picker__body">
      <div v-if="items.length" class="album-cover-picker__grid" role="group" :aria-label="t('albumCover.choose')">
        <button v-for="item in items" :key="item.imageId" type="button" class="album-cover-picker__item"
          :aria-label="item.filename" :aria-current="item.imageId === currentCoverId ? true : undefined" :aria-pressed="selected === item.imageId" :disabled="saving"
          @click="selected = item.imageId">
          <ResilientImage :src="item.thumbnailUrl" :alt="item.filename" :max-retries="1" loading="lazy"/>
          <span v-if="item.imageId === currentCoverId" class="album-cover-picker__current">{{ t('albumCover.current') }}</span>
          <span v-if="selected === item.imageId" class="album-cover-picker__check i-fluent-checkmark-circle-24-filled" aria-hidden="true"/>
        </button>
      </div>
      <p v-if="loading" role="status" class="text-sm text-muted">{{ t('common.loadingMore') }}</p>
      <p v-else-if="!items.length && !loadError" class="text-sm text-muted">{{ t('albumCover.empty') }}</p>
      <p v-if="loadError" role="alert" class="text-sm">{{ t('albumCover.loadError') }}</p>
      <button v-if="hasMore && !loading" type="button" class="btn-ghost" :disabled="saving" @click="load">{{ t(loadError ? 'common.retry' : 'common.loadMore') }}</button>
      <p v-if="saveError" role="alert" class="text-sm">{{ t('albumCover.saveError') }}</p>
    </div>
    <footer class="album-cover-picker__footer">
      <button type="button" class="btn-ghost" :disabled="saving" @click="cancel">{{ t('common.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="saving || selected === null" @click="save">{{ t(saving ? 'common.saving' : 'albumCover.save') }}</button>
    </footer>
  </dialog>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchFolderImages } from '../api/gallery';
import { useAuthStore } from '../stores/auth';
import { useFoldersStore } from '../stores/folders';
import ResilientImage from './ResilientImage.vue';

const props = defineProps<{slug: string; currentCoverId: number | null}>();
const emit = defineEmits<{close: []}>();
const { t } = useI18n();
const auth = useAuthStore();
const folders = useFoldersStore();
const dialog = ref<HTMLDialogElement | null>(null);
const headingId = useId();
type Cover = {imageId: number; filename: string; thumbnailUrl: string};
const items = ref<Cover[]>([]);
const selected = ref<number | null>(null);
const loading = ref(false);
const saving = ref(false);
const loadError = ref(false);
const saveError = ref(false);
const hasMore = ref(true);
let page = 1, generation = 0;
const allowed = () => auth.canManageLibrary && !auth.externalFamilyAccess;

async function load() {
  if (!allowed() || loading.value || !hasMore.value) return;
  const current = generation;
  loading.value = true;
  loadError.value = false;
  try {
    const result = await fetchFolderImages(props.slug, page, 24, 'image');
    if (current !== generation || !allowed()) return;
    const seen = new Set(items.value.map(item => item.imageId));
    for (const post of result.items) {
      const candidates = post.mediaItems?.length
        ? post.mediaItems
        : [{imageId:post.id, filename:post.filename, thumbnailUrl:post.thumbnailUrl, mediaType:post.mediaType}];
      for (const candidate of candidates) {
        if (candidate.mediaType !== 'image' || seen.has(candidate.imageId)) continue;
        items.value.push({imageId:candidate.imageId, filename:candidate.filename, thumbnailUrl:candidate.thumbnailUrl});
        seen.add(candidate.imageId);
      }
    }
    hasMore.value = result.hasMore;
    page = result.page + 1;
  } catch {
    if (current === generation) loadError.value = true;
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function save() {
  if (!allowed() || saving.value || selected.value === null) return;
  const current = generation;
  saving.value = true;
  saveError.value = false;
  try {
    await folders.setFolderCover(props.slug, selected.value);
    if (current === generation) emit('close');
  } catch {
    if (current === generation) saveError.value = true;
  } finally {
    if (current === generation) saving.value = false;
  }
}
function cancel() { if (!saving.value) emit('close'); }
function handleBackdrop(event: MouseEvent) {
  const element = dialog.value;
  if (!element || event.target !== element) return;
  const bounds = element.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
}
watch(() => [props.slug, allowed()] as const, () => { generation++; emit('close'); });
onMounted(() => {
  if (!allowed()) { emit('close'); return; }
  dialog.value?.showModal();
  void load();
});
onBeforeUnmount(() => { generation++; if (dialog.value?.open) dialog.value.close(); });
</script>
<style scoped>
.album-cover-picker { margin:auto; width:min(560px, calc(100% - 24px)); max-height:min(760px,calc(100dvh - 24px)); overflow:hidden; border:1px solid var(--border); border-radius:16px; background:var(--surface); color:var(--text); padding:0; }
.album-cover-picker[open] { display:flex; flex-direction:column; }
.album-cover-picker::backdrop { background:rgba(0,0,0,.55); }
.album-cover-picker__header { padding:20px 20px 14px; }
.album-cover-picker__header h2 { margin:0; font-size:1.2rem; font-weight:650; }
.album-cover-picker__header p { margin:6px 0 0; color:var(--muted); font-size:.9rem; }
.album-cover-picker__body { min-height:0; overflow-y:auto; padding:0 20px 16px; }
.album-cover-picker__grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.album-cover-picker__item { position:relative; aspect-ratio:4/3; min-width:0; overflow:hidden; border:2px solid transparent; border-radius:8px; padding:0; background:var(--surface-alt); cursor:pointer; }
.album-cover-picker__item img { display:block; width:100%; height:100%; object-fit:cover; }
.album-cover-picker__item[aria-pressed="true"] { border-color:var(--accent-strong); }
.album-cover-picker__item:focus-visible { outline:2px solid var(--accent-strong); outline-offset:2px; }
.album-cover-picker__current { position:absolute; bottom:5px; left:5px; max-width:calc(100% - 10px); padding:3px 6px; background:#111; color:#fff; font-size:.72rem; border-radius:4px; overflow-wrap:anywhere; }
.album-cover-picker__check { position:absolute; top:6px; right:6px; width:24px; height:24px; color:#fff; background:var(--accent-strong); border-radius:50%; }
.album-cover-picker__footer { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--border); }
.album-cover-picker__footer button { min-height:44px; }
</style>