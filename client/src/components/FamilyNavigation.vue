<template>
  <header class="family-header" :inert="inert" :aria-hidden="inert ? true : undefined">
    <div class="family-header__inner">
      <RouterLink to="/" class="family-brand">
        <span class="family-brand__mark"><BrandMark /></span>
        <span class="family-brand__name">{{ branding.value.name }}</span>
      </RouterLink>
      <nav class="family-desktop-nav" :aria-label="t('nav.primary')">
        <RouterLink v-for="item in items" :key="item.name" :to="{name:item.name}"
          :class="['family-link', {'family-link--active': isActive(item.name)}]"
          :aria-current="isActive(item.name) ? 'page' : undefined">
          <span :class="[item.icon, 'family-link__icon']" aria-hidden="true" />
          <span>{{ t(item.label) }}</span>
        </RouterLink>
      </nav>
      <button ref="moreButton" class="family-more" type="button" :aria-label="t('nav.more')"
        :aria-expanded="menuOpen" aria-controls="family-navigation-menu" @click="menuOpen = !menuOpen">
        <span class="i-fluent-more-horizontal-24-regular family-link__icon" aria-hidden="true"/>
        <span class="family-more__label">{{ t('nav.more') }}</span>
      </button>
      <div v-if="menuOpen" class="family-menu-backdrop" @click="closeMenu(false)" aria-hidden="true"/>
      <section v-if="menuOpen" ref="menuElement" id="family-navigation-menu" class="family-menu" :aria-label="t('nav.more')">
        <p class="family-menu__member">{{ auth.familyMember?.name }}</p>
        <RouterLink class="family-menu__link" :to="{name:'reels'}" @click="closeMenu(false)"><span class="i-fluent-play-circle-24-regular family-link__icon" aria-hidden="true"/>{{ t('nav.reels') }}</RouterLink>
        <RouterLink v-if="places.items.length && !places.listError" class="family-menu__link" :to="{name:'places'}" @click="closeMenu(false)"><span class="i-fluent-location-20-regular family-link__icon" aria-hidden="true"/>{{ t('nav.places') }}</RouterLink>
        <RouterLink v-if="auth.canUseSharedCollections || auth.canUseLocalCollections" class="family-menu__link" :to="{name:'collections'}" @click="closeMenu(false)"><span class="i-fluent-bookmark-20-regular family-link__icon" aria-hidden="true"/>{{ t('nav.collections') }}</RouterLink>
        <button type="button" class="family-menu__link" @click="openPreferences"><span class="i-fluent-desktop-20-regular family-link__icon" aria-hidden="true"/>{{ t('displayPreferences.title') }}</button>
        <FamilyPushSettings class="family-menu__push" />
        <button v-if="auth.canSignOut" type="button" class="family-menu__link" :disabled="auth.loading" @click="signOut"><span class="i-fluent-arrow-exit-20-regular family-link__icon" aria-hidden="true"/>{{ t('nav.signOut') }}</button>
        <p v-if="signOutError" role="alert" class="family-menu__error">{{ signOutError }}</p>
      </section>
    </div>
  </header>
  <nav class="family-mobile-nav" :inert="inert" :aria-hidden="inert ? true : undefined" :aria-label="t('nav.primary')">
    <RouterLink v-for="item in items" :key="item.name" :to="{name:item.name}"
      :class="['family-link', {'family-link--active': isActive(item.name)}]"
      :aria-current="isActive(item.name) ? 'page' : undefined" @click="closeMenu(false)">
      <span :class="[item.icon, 'family-link__icon']" aria-hidden="true" />
      <span>{{ t(item.label) }}</span>
    </RouterLink>
  </nav>
</template>
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { useBrandingStore } from '../stores/branding';
import { usePlacesStore } from '../stores/places';
import BrandMark from './BrandMark.vue';
import FamilyPushSettings from './FamilyPushSettings.vue';

const props = defineProps<{inert?: boolean}>();
const { t } = useI18n();
const auth = useAuthStore();
const branding = useBrandingStore();
const places = usePlacesStore();
const route = useRoute();
const router = useRouter();
const emit = defineEmits<{ openDisplayPreferences: [anchor: HTMLButtonElement] }>();
const items = [
  {name:'home', label:'nav.home', icon:'i-fluent-home-24-regular'},
  {name:'library', label:'familyGallery.albums', icon:'i-fluent-image-multiple-24-regular'},
  {name:'explore', label:'nav.search', icon:'i-fluent-search-24-regular'},
  {name:'likes', label:'familyGallery.favorites', icon:'i-fluent-heart-24-regular'}
] as const;
const menuOpen = ref(false);
const moreButton = ref<HTMLButtonElement | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const signOutError = ref('');
function isActive(name: string) {
  return route.name === name || (name === 'library' && route.name === 'folder');
}
function closeMenu(restoreFocus = true) {
  const wasOpen = menuOpen.value;
  menuOpen.value = false;
  if (wasOpen && restoreFocus) void nextTick(() => moreButton.value?.focus());
}
function openPreferences() {
  closeMenu(false);
  if (moreButton.value) emit('openDisplayPreferences', moreButton.value);
}
async function signOut() {
  signOutError.value = '';
  try {
    await auth.logout();
    closeMenu(false);
    await router.replace({name:'home'});
  } catch {
    signOutError.value = t('settings.access.danger.signOutError');
  }
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuOpen.value) { event.preventDefault(); closeMenu(); }
}
// This is a disclosure, not a modal. Keyboard users can leave it naturally,
// but the popover must not stay open over the newly focused page content.
function onFocusIn(event: FocusEvent) {
  if (!menuOpen.value || !(event.target instanceof Node)) return;
  if (moreButton.value?.contains(event.target) || menuElement.value?.contains(event.target)) return;
  closeMenu(false);
}
watch(() => route.fullPath, () => closeMenu(false));
watch(() => props.inert, value => { if (value) closeMenu(false); });
onMounted(() => {
  void places.fetchPlaces();
  window.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('focusin', onFocusIn);
});
</script>
<style scoped>
.family-header { position: relative; z-index: 35; flex-shrink: 0; border-bottom: 1px solid var(--border); background: var(--surface); }
.family-header__inner { position: relative; display: flex; align-items: center; gap: 20px; min-height: 64px; max-width: 1200px; padding: 8px clamp(16px, 4vw, 36px); margin: auto; }
.family-brand { display: inline-flex; align-items: center; gap: 10px; min-width: 0; color: var(--text); text-decoration: none; }
.family-brand__mark { width: 28px; height: 28px; flex: 0 0 auto; display: grid; place-items: center; }
.family-brand__mark :deep(svg), .family-brand__mark :deep(img) { width: 100%; height: 100%; object-fit: contain; }
.family-brand__name { font-size: 1.1rem; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.family-desktop-nav { display: flex; align-items: center; justify-content: center; gap: 4px; flex: 1; }
.family-link { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: .9rem; font-weight: 550; text-decoration: none; min-height: 44px; padding: 8px 14px; border-radius: 12px; }
.family-link--active { color: var(--accent-strong); background: var(--accent-soft); }
.family-link__icon { width: 22px; height: 22px; flex-shrink: 0; }
.family-more { margin-left: auto; min-height: 44px; min-width: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px; background: transparent; color: var(--text); cursor: pointer; padding: 8px 12px; }
.family-more[aria-expanded="true"] { background: var(--surface-alt); }
.family-menu-backdrop { position: fixed; inset: 0; z-index: 1; }
.family-menu { position: absolute; z-index: 2; top: calc(100% + 4px); right: clamp(12px, 4vw, 36px); width: min(330px, calc(100vw - 24px)); max-height: calc(100dvh - 148px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); padding: 8px; }
.family-menu__member { font-size: .9rem; font-weight: 600; padding: 8px 12px 12px; margin: 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.family-menu__link { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; text-align: left; border: 0; border-radius: 10px; background: transparent; color: var(--text); padding: 10px 12px; font-size: .9rem; text-decoration: none; cursor: pointer; }
.family-menu__push { margin: 4px 0; }
.family-menu__error { margin: 6px 12px; color: var(--text); font-size: .85rem; }
.family-mobile-nav { display: none; }
@media (hover: hover) {
  .family-link:hover, .family-more:hover, .family-menu__link:hover { background: var(--surface-hover); color: var(--text); }
}
.family-link:focus-visible, .family-more:focus-visible, .family-menu__link:focus-visible, .family-brand:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
@media (max-width: 767.98px) {
  .family-header__inner { min-height: 56px; gap: 8px; padding: 6px 16px; padding-top: calc(6px + env(safe-area-inset-top, 0px)); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .family-desktop-nav, .family-more__label { display: none; }
  .family-mobile-nav { position: fixed; z-index: 30; bottom: 0; inset-inline: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--surface); border-top: 1px solid var(--border); padding: 6px max(8px, env(safe-area-inset-right, 0px)) calc(6px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px)); gap: 4px; }
  .family-mobile-nav .family-link { flex-direction: column; min-height: 52px; gap: 4px; padding: 4px 2px; font-size: .78rem; line-height: 1.2; text-align: center; overflow-wrap: anywhere; }
  .family-mobile-nav .family-link__icon { width: 23px; height: 23px; }
}
</style>