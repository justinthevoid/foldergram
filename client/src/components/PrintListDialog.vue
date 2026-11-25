<template>
  <dialog ref="dialog" class="print-list" :aria-labelledby="headingId" @cancel.prevent="emit('close')">
    <header class="print-list__header">
      <div>
        <h2 :id="headingId">{{ t('printList.title') }}</h2>
        <p>{{ t('printList.description') }}</p>
      </div>
      <button type="button" class="btn-ghost" @click="emit('close')">{{ t('common.close') }}</button>
    </header>

    <div class="print-list__body">
      <div class="print-list__count">
        <strong role="status">{{ t('printList.selected', { count: selectedPhotos.length }) }}</strong>
        <button v-if="selectedPhotos.length" type="button" class="btn-ghost" @click="selected = []">{{ t('printList.clear') }}</button>
      </div>
      <p v-if="!photos.length" class="text-muted">{{ t('printList.empty') }}</p>
      <div v-else class="print-list__grid">
        <label v-for="photo in visiblePhotos" :key="photo.key" class="print-list__tile"
          :class="{ 'print-list__tile--selected': selected.includes(photo.key) }">
          <span class="print-list__image">
            <ResilientImage :src="photo.thumbnailUrl" alt="" loading="lazy" :max-retries="1" />
            <input v-model="selected" type="checkbox" :value="photo.key"
              :aria-label="photoLabel(photo)" />
          </span>
          <span class="print-list__name">{{ photo.filename }}</span>
          <span class="print-list__album">{{ photo.album }}</span>
        </label>
      </div>
      <button v-if="visibleCount < photos.length" type="button" class="btn-ghost min-h-11" @click="visibleCount += PAGE_SIZE">{{ t('common.loadMore') }}</button>
      <div v-if="selectedPhotos.length" class="print-list__message">
        <label :for="headingId + '-message'">{{ t('printList.messageLabel') }}</label>
        <textarea :id="headingId + '-message'" ref="messageInput" readonly rows="4" :value="message" />
        <p>{{ t('printList.shareHint') }}</p>
      </div>
    </div>

    <footer class="print-list__footer">
      <p role="status">{{ status ? t(status) : '' }}</p>
      <div class="print-list__actions">
        <button type="button" class="btn-ghost" :disabled="!selectedPhotos.length || busy" @click="copyList">{{ t('printList.copy') }}</button>
        <button v-if="canShare" type="button" class="btn-primary" :disabled="!selectedPhotos.length || busy" @click="shareList">{{ t('printList.share') }}</button>
      </div>
    </footer>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { singlePrintLine, type PrintPhoto } from '../utils/print-list';
import ResilientImage from './ResilientImage.vue';

const props = defineProps<{ photos: PrintPhoto[] }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const headingId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const messageInput = ref<HTMLTextAreaElement | null>(null);
const selected = ref<string[]>([]);
const PAGE_SIZE = 48;
const visibleCount = ref(PAGE_SIZE);
const busy = ref(false);
const status = ref('');
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
const visiblePhotos = computed(() => props.photos.slice(0, visibleCount.value));
const selectedPhotos = computed(() => {
  const keys = new Set(selected.value);
  return props.photos.filter(photo => keys.has(photo.key));
});
function photoLabel(photo: PrintPhoto) {
  const values = { album: singlePrintLine(photo.album), filename: singlePrintLine(photo.filename),
    post: photo.postId, slide: photo.slideNumber };
  return t(photo.slideNumber === null ? 'printList.entry' : 'printList.carouselEntry', values);
}
const message = computed(() => [t('printList.intro'), ...selectedPhotos.value.map(photo => '- ' + photoLabel(photo))].join('\n'));
watch(() => props.photos, photos => {
  const available = new Set(photos.map(photo => photo.key));
  selected.value = selected.value.filter(key => available.has(key));
});
watch(selected, () => { status.value = ''; });
async function copyList() {
  if (!selectedPhotos.value.length || busy.value) return;
  busy.value = true;
  status.value = '';
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(message.value);
    status.value = 'printList.copied';
  } catch {
    messageInput.value?.focus();
    messageInput.value?.select();
    status.value = 'printList.manualCopy';
  } finally {
    busy.value = false;
  }
}
async function shareList() {
  if (!selectedPhotos.value.length || busy.value || !canShare) return;
  busy.value = true;
  status.value = '';
  try {
    await navigator.share({ text: message.value });
  } catch (error) {
    // DOMException may come from a different realm (including embedded browsers).
    if (!(typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')) {
      status.value = 'printList.shareFailed';
    }
  } finally {
    busy.value = false;
  }
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close(); });
</script>

<style scoped>
.print-list { box-sizing: border-box; margin: auto; padding: 0; width: min(640px, calc(100% - 24px)); max-height: calc(100dvh - 24px); border: 1px solid var(--border); border-radius: 18px; background: var(--surface); color: var(--text); overflow: hidden; }
.print-list[open] { display: flex; flex-direction: column; }
.print-list::backdrop { background: rgba(0,0,0,.55); }
.print-list__header { padding: 18px 20px 14px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.print-list__header h2 { margin: 0; font-size: 1.2rem; font-weight: 650; }
.print-list__header p, .print-list__message p { margin: 6px 0 0; font-size: .85rem; line-height: 1.45; color: var(--muted); }
.print-list__body { min-height: 0; overflow-y: auto; padding: 12px 20px 18px; display: grid; gap: 12px; }
.print-list__count { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; font-size: .88rem; }
.print-list__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.print-list__tile { cursor: pointer; display: grid; align-content: start; gap: 3px; min-width: 0; border: 2px solid transparent; border-radius: 10px; padding: 4px; background: var(--surface-alt); overflow: hidden; }
.print-list__tile--selected { border-color: var(--accent-strong); }
.print-list__tile:focus-within { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.print-list__image { position: relative; display: block; aspect-ratio: 4/3; overflow: hidden; border-radius: 6px; }
.print-list__image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.print-list__image input { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; accent-color: var(--accent-strong); cursor: pointer; }
.print-list__name, .print-list__album { padding: 0 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .75rem; }
.print-list__name { font-weight: 600; }
.print-list__album { color: var(--muted); }
.print-list__message { display: grid; gap: 6px; font-size: .85rem; }
.print-list__message label { font-weight: 600; }
.print-list__message textarea { width: 100%; resize: vertical; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-alt); color: var(--text); padding: 10px; font: inherit; }
.print-list__footer { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.print-list__footer p { margin: 0; color: var(--muted); font-size: .8rem; }
.print-list__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.print-list button { min-height: 44px; }
@media (max-width: 480px) {
  .print-list__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .print-list__body, .print-list__header, .print-list__footer { padding-inline: 12px; }
}
</style>
