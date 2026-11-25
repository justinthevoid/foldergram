<template>
  <section class="w-[min(100%,58rem)] mx-auto">
    <EmptyState
      v-if="appStore.isLibraryUnavailable"
      :title="t('common.libraryUnavailableTitle')"
      :description="appStore.libraryUnavailableReason"
    />
    <section v-else-if="appStore.isRebuilding && likesStore.items.length === 0" class="card p-8 text-center">
      <p class="m-0 text-muted">{{ t('likes.view.rebuilding', { label: likesStore.collectionLabel }) }}</p>
    </section>
    <ErrorState v-else-if="likesStore.error" :title="likesStore.errorTitle" :message="likesStore.error" />
    <template v-else>
      <header v-if="familyPresentation" class="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 class="m-0 text-[clamp(1.55rem,3vw,2rem)] font-semibold">{{ t('familyGallery.favorites') }}</h1>
        <div class="flex flex-wrap items-center gap-2">
          <RouterLink v-if="authStore.canUseLocalCollections || authStore.canUseSharedCollections"
            :to="{ name: 'collections' }" class="btn-ghost min-h-11 inline-flex items-center gap-2">
            <span class="i-fluent-bookmark-20-regular w-5 h-5" aria-hidden="true" />{{ t('nav.collections') }}
          </RouterLink>
          <button v-if="likesStore.mode === 'family' && !likesStore.loading && printPhotos.length"
            type="button" class="btn-ghost min-h-11 inline-flex items-center gap-2" @click="printListOpen = true">
            <span class="i-fluent-print-20-regular w-5 h-5" aria-hidden="true" />{{ t('printList.title') }}
          </button>
        </div>
      </header>
      <div v-else class="flex justify-center py-[0.95rem] mb-[0.45rem] border-t border-border" :aria-label="t('likes.view.sectionsAria', { label: likesStore.collectionLabel })">
        <span class="relative pt-[0.1rem] text-text text-[0.78rem] font-bold tracking-[0.11em] uppercase">
          <span class="absolute left-0 right-0 top-[-1.05rem] h-px bg-text" aria-hidden="true"></span>
          {{ likesStore.collectionSectionLabel }}
        </span>
      </div>
      <EmptyState
        v-if="!likesStore.loading && likesStore.items.length === 0"
        :title="familyPresentation ? t('familyGallery.favoritesEmpty') : likesStore.emptyTitle"
        :description="familyPresentation ? t('familyGallery.favoritesHelp') : likesStore.emptyDescription"
      />
      <div v-else-if="likesStore.loading" class="card p-8 text-center">
        <p class="text-muted">{{ likesStore.loadingLabel }}</p>
      </div>
      <FolderGrid v-else :items="likesStore.items" />
      <PrintListDialog v-if="printListOpen && familyPresentation && likesStore.mode === 'family' && !likesStore.loading"
        :photos="printPhotos" @close="printListOpen = false" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { useFamilyPresentation } from '../composables/useFamilyPresentation';
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FolderGrid from '../components/FolderGrid.vue';
import PrintListDialog from '../components/PrintListDialog.vue';
import { getPrintPhotos } from '../utils/print-list';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { useLikesStore } from '../stores/likes';

const appStore = useAppStore();
const likesStore = useLikesStore();
const { t } = useI18n();
const familyPresentation = useFamilyPresentation();
const authStore = useAuthStore();
const printListOpen = ref(false);
const printPhotos = computed(() => familyPresentation.value && likesStore.mode === 'family' ? getPrintPhotos(likesStore.items) : []);
watch(() => [authStore.familyMember?.id, familyPresentation.value, likesStore.mode] as const,
  () => { printListOpen.value = false; }, { flush: 'sync' });

onMounted(async () => {
  if (appStore.isLibraryUnavailable) {
    return;
  }

  await likesStore.initialize();
});
</script>
