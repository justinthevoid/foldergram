<template>
  <section v-if="branding.ready && (branding.value.name !== 'Foldergram' || branding.value.photographer || branding.value.bio || branding.value.logo)"
    class="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-4 mb-3">
    <img v-if="branding.value.logo" :src="branding.value.logo" alt="" class="w-14 h-14 shrink-0 rounded-xl object-contain bg-surface-alt" />
    <div v-else class="flex shrink-0 items-center justify-center rounded-xl w-14 h-14 bg-surface-alt text-accent"><BrandMark /></div>
    <div class="min-w-0">
      <h1 class="m-0 text-xl font-semibold break-words">{{ branding.value.name }}</h1>
      <p v-if="branding.value.photographer" class="m-0 mt-1 text-sm text-muted break-words">{{ branding.value.photographer }}</p>
      <p v-if="branding.value.bio" class="m-0 mt-2 text-sm leading-relaxed whitespace-pre-line break-words">{{ branding.value.bio }}</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { useBrandingStore } from '../stores/branding';
import BrandMark from './BrandMark.vue';
const branding = useBrandingStore();
</script>