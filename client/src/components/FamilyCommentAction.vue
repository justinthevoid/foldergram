<template>
  <button v-if="scope" v-bind="$attrs" type="button"
    :aria-label="t('comments.title')" :title="t('comments.title')"
    :aria-expanded="open" @click.stop="show">
    <span class="i-fluent-chat-24-regular family-comment-action__icon" aria-hidden="true"/>
  </button>
  <Teleport to="body">
    <dialog v-if="scope && open" ref="dialog" class="family-comment-dialog" :aria-labelledby="headingId"
      @cancel.prevent="close" @keydown.stop @wheel.stop @touchmove.stop @click.stop="backdropClick">
      <header class="family-comment-dialog__header">
        <h2 :id="headingId">{{ t('comments.title') }}</h2>
        <button type="button" class="family-comment-dialog__close" :aria-label="t('media.closeViewer')" @click="close">
          <span class="i-fluent-dismiss-24-regular w-6 h-6" aria-hidden="true"/>
        </button>
      </header>
      <div class="family-comment-dialog__content">
        <FamilyComments :post-id="postId" embedded />
      </div>
    </dialog>
  </Teleport>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFamilyCommentScope } from '../composables/useFamilyCommentScope';
import FamilyComments from './FamilyComments.vue';

defineOptions({inheritAttrs:false});
const props = defineProps<{postId:number}>();
const {t} = useI18n();
const scope = useFamilyCommentScope();
const open = ref(false);
const dialog = ref<HTMLDialogElement|null>(null);
const headingId = useId();
let opener: HTMLElement|null = null;

async function show(event:MouseEvent) {
  if (!scope.value || open.value) return;
  opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  open.value = true;
  await nextTick();
  if (scope.value && open.value) dialog.value?.showModal();
}
function close() {
  if (dialog.value?.open) dialog.value.close();
  open.value = false;
  const target = opener;
  opener = null;
  if (target?.isConnected && scope.value) void nextTick(()=>target.focus({preventScroll:true}));
}
function backdropClick(event:MouseEvent) {
  const el = dialog.value;
  if (!el || event.target !== el) return;
  const bounds = el.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
}
watch(()=>[scope.value, props.postId] as const, close, {flush:'sync'});
onBeforeUnmount(()=>{if(dialog.value?.open)dialog.value.close();});
</script>
<style scoped>
.family-comment-action__icon { width:1.45rem; height:1.45rem; display:inline-block; }
.family-comment-dialog { margin:auto; width:min(480px,calc(100% - 24px)); max-height:min(680px,calc(100dvh - 24px)); padding:0; overflow:hidden; border:1px solid var(--border); border-radius:16px; color:var(--text); background:var(--surface); }
.family-comment-dialog[open] { display:flex; flex-direction:column; }
.family-comment-dialog::backdrop { background:rgba(0,0,0,.55); }
.family-comment-dialog__header { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; padding:10px 16px; border-bottom:1px solid var(--border); }
.family-comment-dialog__header h2 { margin:0; font-size:1.1rem; font-weight:650; }
.family-comment-dialog__close { display:grid; place-items:center; min-width:44px; min-height:44px; border:0; background:transparent; color:var(--text); border-radius:10px; cursor:pointer; }
.family-comment-dialog__close:focus-visible { outline:2px solid var(--accent-strong); }
.family-comment-dialog__content { min-height:0; overflow:auto; overscroll-behavior:contain; padding-bottom:12px; }
@media (max-width:600px) {
  .family-comment-dialog { margin:auto 0 0; width:100%; max-width:100%; max-height: min(82dvh, 680px); border-radius:16px 16px 0 0; padding-bottom:env(safe-area-inset-bottom,0px); }
}
</style>