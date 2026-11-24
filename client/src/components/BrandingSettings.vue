<template>
  <section v-if="auth.canAccessSettings" class="card overflow-visible p-0">
    <header class="border-b border-border px-6 py-5">
      <h2 class="m-0 text-[1.18rem]">{{ t('branding.title') }}</h2>
      <p class="m-0 mt-1 text-muted">{{ t('branding.description') }}</p>
    </header>
    <form @submit.prevent="save">
      <div class="grid gap-5 px-6 py-5">
        <div class="flex flex-wrap items-center gap-4">
          <div class="w-20 h-20 rounded-xl bg-surface-alt border border-border flex items-center justify-center">
            <img v-if="draft.logo" :src="draft.logo" alt="" class="w-full h-full object-contain rounded-xl" />
            <span v-else class="i-fluent-image-24-regular w-8 h-8 text-muted" aria-hidden="true" />
          </div>
          <div class="grid gap-2 min-w-0 flex-1">
            <label class="grid gap-1 font-medium">
              {{ t('branding.logo') }}
              <input type="file" accept="image/jpeg,image/png,image/webp" class="max-w-full text-sm" :disabled="disabled" @change="chooseLogo" />
            </label>
            <button v-if="draft.logo" type="button" class="text-sm self-start text-start text-accent font-medium" :disabled="disabled" @click="draft.logo = ''">{{ t('branding.removeLogo') }}</button>
            <p class="m-0 text-sm text-muted">{{ t('branding.publicHelp') }}</p>
          </div>
        </div>
        <label class="grid gap-2 font-medium">
          {{ t('branding.name') }}
          <input v-model="draft.name" maxlength="60" required class="border border-border rounded-lg p-3 bg-surface text-text" :disabled="disabled" />
        </label>
        <label class="grid gap-2 font-medium">
          {{ t('branding.photographer') }}
          <input v-model="draft.photographer" maxlength="80" class="border border-border rounded-lg p-3 bg-surface text-text" :disabled="disabled" />
        </label>
        <label class="grid gap-2 font-medium">
          {{ t('branding.bio') }}
          <textarea v-model="draft.bio" maxlength="400" rows="4" class="border border-border rounded-lg p-3 bg-surface text-text resize-y" :disabled="disabled" />
          <span class="text-sm font-normal text-muted">{{ t('branding.profileHelp') }}</span>
        </label>
        <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ error }}</p>
        <p v-else-if="saved" role="status" class="m-0 text-sm">{{ t('branding.saved') }}</p>
      </div>
      <footer class="border-t border-border px-6 py-5 flex justify-end">
        <button class="btn-primary" type="submit" :disabled="disabled || !draft.name.trim()">{{ t(saving ? 'branding.saving' : 'branding.save') }}</button>
      </footer>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { useBrandingStore } from '../stores/branding';

const { t } = useI18n();
const auth = useAuthStore();
const branding = useBrandingStore();
const draft = reactive({ ...branding.value });
const error = ref('');
const saved = ref(false);
const saving = ref(false);
const processing = ref(false);
const disabled = computed(() => !auth.canWriteAppearance || !branding.ready || saving.value || processing.value);
watch(() => branding.value, value => Object.assign(draft, value));
watch(draft, () => { saved.value = false; }, { deep: true });

async function chooseLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || disabled.value) return;
  error.value = '';
  processing.value = true;
  let bitmap: ImageBitmap | undefined;
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      throw new Error('invalid image');
    }
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    const scale = Math.min(160 / bitmap.width, 160 / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (160 - w) / 2, (160 - h) / 2, w, h);
    const logo = canvas.toDataURL('image/webp', 0.8);
    if (logo.length > 70000) throw new Error('image too large');
    draft.logo = logo;
  } catch { error.value = t('branding.logoError'); }
  finally { bitmap?.close(); processing.value = false; }
}
async function save() {
  if (disabled.value) return;
  saving.value = true;
  error.value = '';
  saved.value = false;
  try { await branding.save({ ...draft }); saved.value = true; }
  catch { error.value = t('branding.saveError'); }
  finally { saving.value = false; }
}
</script>