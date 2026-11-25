<template>
  <div :class="['family-album-grid', {'family-album-grid--preview': preview}]">
    <RouterLink v-for="(folder, index) in folders" :key="folder.id" class="family-album"
      :to="{name:'folder', params:{slug:folder.slug}}">
      <div class="family-album__cover">
        <span class="family-album__placeholder i-fluent-image-multiple-24-regular" aria-hidden="true"/>
        <ResilientImage v-if="folder.avatarUrl" :src="folder.avatarUrl" alt=""
          :loading="index < 2 ? 'eager' : 'lazy'" :max-retries="2" class="family-album__image"/>
      </div>
      <div class="family-album__meta">
        <p class="family-album__title">{{ formatFolderTitle(folder, app.nestedFolderTitleFormat) }}</p>
        <p class="family-album__detail">
          {{ t(folder.imageCount === 1 ? 'familyGallery.itemOne' : 'familyGallery.itemOther', {count:formatCount(folder.imageCount)}) }}
          <span v-if="!preview && folder.latestImageMtimeMs"> · {{ t('familyGallery.updated', {date:formatDate(folder.latestImageMtimeMs)}) }}</span>
        </p>
      </div>
    </RouterLink>
  </div>
</template>
<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import ResilientImage from './ResilientImage.vue';
import { useAppStore } from '../stores/app';
import { formatFolderTitle } from '../utils/folder-titles';
import type { FolderSummary } from '../types/api';

defineProps<{folders: FolderSummary[]; preview?: boolean}>();
const { t, locale } = useI18n();
const app = useAppStore();
function formatCount(value:number) { return new Intl.NumberFormat(locale.value).format(value); }
function formatDate(value:number) { return new Intl.DateTimeFormat(locale.value, {month:'short',day:'numeric',year:'numeric'}).format(value); }
</script>
<style scoped>
.family-album-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px 14px; }
.family-album { display: block; min-width: 0; color: var(--text); text-decoration: none; }
.family-album__cover { position: relative; aspect-ratio: 4/3; background: var(--surface-alt); overflow: hidden; border-radius: 12px; display: grid; place-items: center; }
.family-album__image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
.family-album__image[data-loaded="false"] { opacity: 0; }
.family-album__image[data-loaded="true"] { opacity: 1; transition: opacity 140ms ease-out; }
@media (prefers-reduced-motion: reduce) { .family-album__image { transition: none; } }
.family-album__placeholder { width: 28px; height: 28px; color: var(--muted); }
.family-album__meta { padding: 9px 1px 0; }
.family-album__title { margin: 0; font-size: .96rem; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.family-album__detail { margin: 3px 0 0; color: var(--muted); font-size: .81rem; line-height: 1.4; }
.family-album:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 5px; border-radius: 12px; }
@media (hover: hover) { .family-album:hover .family-album__title { color: var(--accent-strong); } }
@media (min-width: 768px) { .family-album-grid:not(.family-album-grid--preview) { grid-template-columns: repeat(3,minmax(0,1fr)); gap: 30px 22px; } .family-album-grid--preview { gap: 18px; } }
@media (min-width: 1100px) { .family-album-grid:not(.family-album-grid--preview) { grid-template-columns: repeat(4,minmax(0,1fr)); } }
</style>