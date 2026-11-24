<template>
  <div v-if="store.canView && names.length" class="text-sm leading-relaxed text-muted break-words">
    <p v-if="names.length <= 3" class="m-0">{{ t('family.reactionsBy', { names: names.join(', ') }) }}</p>
    <details v-else>
      <summary class="cursor-pointer font-medium">{{ t('family.reactionsCount', { count: names.length }) }}</summary>
      <p class="m-0 mt-1">{{ names.join(', ') }}</p>
    </details>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFamilyReactionsStore } from '../stores/family-reactions';
const props = defineProps<{ postId: number }>();
const store = useFamilyReactionsStore();
const { t } = useI18n();
const names = computed(() => store.entries[props.postId]?.names ?? []);
watch(() => [store.canView, props.postId] as const, ([allowed, id]) => {
  if (allowed) store.load(id);
  else if (Object.keys(store.entries).length || store.pending.length || store.queued.length) store.reset();
}, { immediate: true });
const refresh = () => store.load(props.postId, true);
onMounted(() => window.addEventListener('focus', refresh));
onUnmounted(() => window.removeEventListener('focus', refresh));
</script>