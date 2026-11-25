<template>
  <section v-if="scope" class="grid gap-3 px-5 pt-5 pb-2" data-test="family-comments">
    <header class="flex items-center justify-between gap-2">
      <h3 :class="embedded ? 'sr-only' : 'm-0 text-sm font-semibold'">{{ t('comments.title') }}</h3>
      <button type="button" class="ml-auto inline-flex items-center justify-center w-11 h-11 rounded-lg text-muted hover:bg-surface-alt disabled:opacity-50"
        :aria-label="t('comments.refresh')" :title="t('comments.refresh')" :disabled="loading || busy" @click="load(false)">
        <span class="i-fluent-arrow-clockwise-20-regular w-5 h-5" aria-hidden="true" />
      </button>
    </header>
    <p v-if="loading && !items.length" class="m-0 text-sm text-muted">{{ t('comments.loading') }}</p>
    <p v-else-if="!items.length && !error" class="m-0 text-sm text-muted">{{ t('comments.empty') }}</p>
    <article v-for="comment in items" :key="comment.id" class="grid gap-1.5 border-b border-border pb-3">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong class="text-sm break-words">{{ comment.authorName || t('comments.owner') }}</strong>
        <span class="text-xs text-muted">{{ formatDate(comment.createdAt) }}</span>
        <span v-if="comment.updatedAt" class="text-xs text-muted">{{ t('comments.edited') }}</span>
      </div>
      <p class="m-0 text-sm leading-relaxed whitespace-pre-wrap break-words">{{ comment.body }}</p>
      <div v-if="comment.canEdit || comment.canDelete" class="flex gap-3">
        <button v-if="comment.canEdit" type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-medium text-muted hover:text-text" :disabled="busy" @click="startEdit(comment)">{{ t('comments.edit') }}</button>
        <button v-if="comment.canDelete" type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-medium text-muted hover:text-red-500" :disabled="busy" @click="confirmId = comment.id">{{ t('comments.delete') }}</button>
      </div>
      <div v-if="confirmId === comment.id" class="grid gap-2 rounded-lg border border-border bg-surface-alt p-3">
        <p class="m-0 text-sm">{{ t('comments.deleteConfirm') }}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm" @click="confirmId = null" :disabled="busy">{{ t('comments.cancel') }}</button>
          <button type="button" class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#d93025] text-white px-3 py-2 text-sm font-semibold" :disabled="busy" @click="remove(comment)">{{ t('comments.delete') }}</button>
        </div>
      </div>
    </article>
    <button v-if="nextBeforeId !== null" type="button" class="inline-flex min-h-11 items-center self-start text-sm font-semibold text-accent py-2" :disabled="loading || busy" @click="load(true)">{{ t('comments.older') }}</button>
    <form class="grid gap-2" @submit.prevent="submit">
      <label class="grid gap-1">
        <span class="text-xs font-medium text-muted">{{ t(editId === null ? 'comments.compose' : 'comments.editing') }}</span>
        <textarea v-model="draft" maxlength="1000" rows="2" required class="w-full box-border resize-y min-h-14 rounded-lg border border-border bg-surface text-text p-2.5 text-sm focus:outline-accent"
          :placeholder="t('comments.placeholder')" :disabled="busy" />
      </label>
      <p v-if="editId === null" class="m-0 text-xs text-muted">{{ t('comments.privacy') }}</p>
      <div class="flex justify-end gap-2">
        <button v-if="editId !== null" type="button" class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm" :disabled="busy" @click="cancelEdit">{{ t('comments.cancel') }}</button>
        <button type="submit" class="btn-primary min-h-11" :disabled="busy || loading || !draft.trim()">{{ t(editId === null ? 'comments.post' : 'comments.save') }}</button>
      </div>
    </form>
    <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestJson } from '../api/http';
import { useFamilyCommentScope } from '../composables/useFamilyCommentScope';

interface Comment {
  id: number;
  body: string;
  authorName: string;
  isOwner: boolean;
  createdAt: number;
  updatedAt: number | null;
  canEdit: boolean;
  canDelete: boolean;
}
interface CommentPage { items: Comment[]; nextBeforeId: number | null }
const props = defineProps<{ postId: number; embedded?: boolean }>();
const { t, locale } = useI18n();
const scope = useFamilyCommentScope();
const items = ref<Comment[]>([]);
const draft = ref('');
const editId = ref<number | null>(null);
const confirmId = ref<number | null>(null);
const nextBeforeId = ref<number | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
let revision = 0;

function endpoint() { return '/api/family/posts/' + props.postId + '/comments'; }
function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function reset() {
  revision++;
  items.value = []; draft.value = ''; editId.value = null; confirmId.value = null;
  nextBeforeId.value = null; loading.value = false; busy.value = false; error.value = '';
}
watch(() => [scope.value, props.postId] as const, ([allowed]) => {
  reset();
  if (allowed) void load(false);
}, { immediate: true, flush: 'sync' });
onBeforeUnmount(reset);

async function load(older: boolean) {
  if (!scope.value || loading.value || busy.value || (older && nextBeforeId.value === null)) return;
  const current = revision;
  loading.value = true; error.value = '';
  try {
    const page = await requestJson<CommentPage>(endpoint() + (older ? '?beforeId=' + nextBeforeId.value : ''));
    if (current !== revision) return;
    items.value = older ? [...items.value, ...page.items.filter(c => !items.value.some(existing => existing.id === c.id))] : page.items;
    nextBeforeId.value = page.nextBeforeId;
  } catch { if (current === revision) error.value = t('comments.loadError'); }
  finally { if (current === revision) loading.value = false; }
}
function startEdit(comment: Comment) {
  if (busy.value || !comment.canEdit) return;
  editId.value = comment.id; draft.value = comment.body; confirmId.value = null; error.value = '';
}
function cancelEdit() { editId.value = null; draft.value = ''; }
async function submit() {
  if (!scope.value || busy.value || loading.value || !draft.value.trim()) return;
  const current = revision;
  const id = editId.value;
  busy.value = true; error.value = '';
  try {
    const comment = await requestJson<Comment>(endpoint() + (id === null ? '' : '/' + id), {
      method: id === null ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: draft.value.trim() })
    });
    if (current !== revision) return;
    items.value = id === null ? [comment, ...items.value] : items.value.map(c => c.id === id ? comment : c);
    cancelEdit();
  } catch { if (current === revision) error.value = t('comments.saveError'); }
  finally { if (current === revision) busy.value = false; }
}
async function remove(comment: Comment) {
  if (!scope.value || busy.value || !comment.canDelete || confirmId.value !== comment.id) return;
  const current = revision;
  busy.value = true; error.value = '';
  try {
    await requestJson(endpoint() + '/' + comment.id, { method: 'DELETE' });
    if (current !== revision) return;
    items.value = items.value.filter(c => c.id !== comment.id);
    if (editId.value === comment.id) cancelEdit();
    confirmId.value = null;
  } catch { if (current === revision) error.value = t('comments.deleteError'); }
  finally { if (current === revision) busy.value = false; }
}
</script>