<template>
  <div class="progressive-photo" :class="{'progressive-photo--ready': ready}">
    <img v-if="showPlaceholder" :key="thumbnailSrc" :src="thumbnailSrc" alt="" aria-hidden="true"
      class="progressive-photo__thumbnail" decoding="async" draggable="false" @error="thumbnailFailed = true"/>
    <ResilientImage :key="src" class="progressive-photo__preview" :src="src"
      :fallback-src="thumbnailSrc" :alt="alt" :width="width" :height="height"
      loading="eager" fetch-priority="high" :retry-while="retryWhile"
      :max-retries="2" :show-retry="true" draggable="false" @ready="ready = true"/>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ResilientImage from './ResilientImage.vue';

const props = defineProps<{
  src: string;
  thumbnailSrc: string;
  alt: string;
  width: number;
  height: number;
  retryWhile?: boolean;
}>();
const ready = ref(false);
const thumbnailFailed = ref(false);
const showPlaceholder = computed(() => !!props.thumbnailSrc && props.src !== props.thumbnailSrc && !thumbnailFailed.value);
watch(() => [props.src, props.thumbnailSrc], () => {
  ready.value = false;
  thumbnailFailed.value = false;
}, { flush: 'sync' });
</script>
<style scoped>
.progressive-photo { position: relative; width: 100%; height: 100%; overflow: hidden; }
.progressive-photo__thumbnail, .progressive-photo__preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.progressive-photo__thumbnail { pointer-events: none; }
.progressive-photo__preview[data-loaded="false"] { opacity: 0; }
.progressive-photo__preview[data-loaded="true"] { opacity: 1; transition: opacity 140ms ease-out; }
.progressive-photo--ready .progressive-photo__thumbnail { opacity: 0; transition: opacity 0ms 140ms; }
.progressive-photo button { z-index: 1; }
@media (prefers-reduced-motion: reduce) {
  .progressive-photo__preview, .progressive-photo--ready .progressive-photo__thumbnail { transition: none; }
}
</style>