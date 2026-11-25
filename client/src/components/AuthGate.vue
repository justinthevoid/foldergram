<template>
  <section class="min-h-screen px-6 py-10 flex items-center justify-center" style="background: radial-gradient(circle at top, rgba(var(--accent-rgb),0.14), transparent 32%), linear-gradient(180deg, color-mix(in srgb, var(--bg) 86%, #ffffff 14%) 0%, var(--bg) 100%);">
    <div class="w-full max-w-[27rem] rounded-[1.5rem] border border-border bg-surface p-8 shadow-[var(--shadow)]">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-[1rem] text-on-accent shadow-[0_16px_34px_rgba(var(--accent-rgb),0.24)]" style="background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);">
          <BrandMark />
        </div>
        <div>
          <p v-if="!authStore.externalFamilyAccess" class="m-0 text-[0.74rem] font-bold uppercase tracking-[0.08em] text-accent-strong">{{ t('auth.gate.eyebrow') }}</p>
          <h1 class="m-0 text-[1.5rem] font-semibold tracking-[-0.04em]">{{ authStore.externalFamilyAccess ? (branding.value.name === 'Foldergram' ? t('familyGallery.welcomeTitle') : branding.value.name) : (branding.value.name === 'Foldergram' ? t('auth.gate.title') : branding.value.name) }}</h1>
        </div>
      </div>

      <p class="mt-5 mb-0 text-[0.95rem] leading-[1.65] text-muted">
        {{ description }}
      </p>

      <div v-if="inviteToken" class="mt-6 grid gap-3 rounded-xl border border-border bg-surface-alt p-4">
        <h2 class="m-0 text-lg font-semibold">{{ t('family.joinTitle') }}</h2>
        <p class="m-0 text-sm text-muted">{{ t('family.joinHelp') }}</p>
        <p v-if="inviteError" role="alert" class="m-0 text-sm text-red-500">{{ inviteError }}</p>
        <button class="btn-primary" type="button" :disabled="submitting" @click="acceptInvite">{{ t('family.accept') }}</button>
        <button v-if="authStore.externalFamilyAccess" class="text-sm text-muted" type="button" :disabled="submitting" @click="inviteToken = ''; inviteError = ''">{{ t('family.anotherInvite') }}</button>
        <button v-if="!authStore.externalFamilyAccess" class="text-sm text-muted" type="button" :disabled="submitting" @click="inviteToken = ''">{{ t('family.usePassword') }}</button>
      </div>
      <form v-else-if="authStore.externalFamilyAccess" class="mt-6 grid gap-3" @submit.prevent="pasteInvite">
        <button v-if="passkeysSupported" class="btn-primary min-h-11" type="button" :disabled="submitting" @click="signInWithPasskey">{{ t('passkeys.signIn') }}</button>
        <label class="grid gap-2 text-sm font-medium">
          {{ t('family.pasteInvite') }}
          <input v-model="pastedInvite" type="text" autocomplete="off" class="border border-border rounded-lg p-3 bg-surface text-text" :disabled="submitting" />
        </label>
        <p v-if="inviteError" role="alert" class="m-0 text-sm text-red-500">{{ inviteError }}</p>
        <button class="btn-primary" type="submit" :disabled="submitting || !pastedInvite.trim()">{{ t('family.accept') }}</button>
      </form>
      <form v-else class="mt-6 grid gap-4" @submit.prevent="submitLogin">
        <label class="grid gap-[0.45rem]">
          <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('auth.gate.passwordLabel') }}</span>
          <input
            v-model="password"
            class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
            type="password"
            autocomplete="current-password"
            :placeholder="placeholder"
            :disabled="submitting"
          />
        </label>

        <p v-if="errorMessage" class="m-0 rounded-[0.95rem] border border-[rgba(214,48,49,0.24)] bg-[rgba(214,48,49,0.08)] px-4 py-3 text-[0.88rem] text-[#c0392b]">
          {{ errorMessage }}
        </p>

        <button class="btn-primary min-h-12 justify-center" type="submit" :disabled="submitting || password.length === 0">
          {{ submitting ? t('auth.gate.unlocking') : t('auth.gate.unlock') }}
        </button>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';

import BrandMark from './BrandMark.vue';
import { useBrandingStore } from '../stores/branding';
import { useAuthStore } from '../stores/auth';
import { signInFamilyPasskey, supportsFamilyPasskeys } from '../utils/family-passkeys';

const branding = useBrandingStore();

const { t } = useI18n();
const authStore = useAuthStore();
const password = ref('');
const inviteToken = ref('');
const inviteError = ref('');
const pastedInvite = ref('');
const passkeysSupported = supportsFamilyPasskeys();
let passkeyController: AbortController | null = null;
async function signInWithPasskey() {
  if (submitting.value || !passkeysSupported || !authStore.externalFamilyAccess) return;
  submitting.value = true;
  inviteError.value = '';
  const request = new AbortController();
  passkeyController = request;
  try {
    const result = await signInFamilyPasskey(request.signal);
    if (request.signal.aborted) return;
    authStore.applyStatus(result.auth);
    authStore.clearError();
  } catch {
    if (!request.signal.aborted) inviteError.value = t('passkeys.signInError');
  } finally {
    if (passkeyController === request) passkeyController = null;
    submitting.value = false;
  }
}
onBeforeUnmount(() => { passkeyController?.abort(); });
async function pasteInvite() {
  try {
    const value = pastedInvite.value.trim();
    const url = new URL(value);
    const match = /^#family-invite=([A-Za-z0-9_-]{43})$/.exec(url.hash);
    if (url.origin !== window.location.origin || !match) throw new Error('Invalid invitation');
    inviteToken.value = match[1]!;
    pastedInvite.value = '';
    await acceptInvite();
  } catch { inviteError.value = t('family.joinError'); }
}
onMounted(() => {
  const match = /^#family-invite=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  if (match) {
    inviteToken.value = match[1]!;
    // Strip the bearer token from browser history before using it.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
});
async function acceptInvite() {
  if (!inviteToken.value || submitting.value) return;
  submitting.value = true;
  inviteError.value = '';
  try {
    await authStore.acceptFamilyInvite(inviteToken.value);
    inviteToken.value = '';
  } catch {
    inviteError.value = t('family.joinError');
  } finally {
    submitting.value = false;
  }
}
const submitting = ref(false);
const localError = ref<string | null>(null);
const errorMessage = computed(() => localError.value ?? authStore.error);
const description = computed(() =>
  authStore.externalFamilyAccess ? t('family.externalSignIn') : authStore.accessMode === 'password'
    ? t('auth.gate.descriptionPassword')
    : t('auth.gate.descriptionAdmin')
);
const placeholder = computed(() =>
  authStore.accessMode === 'password' ? t('auth.gate.placeholderPassword') : t('auth.gate.placeholderAdmin')
);

async function submitLogin() {
  if (submitting.value || password.value.length === 0) {
    return;
  }

  submitting.value = true;
  localError.value = null;
  authStore.clearError();

  try {
    await authStore.login(password.value);
    password.value = '';
  } catch (error) {
    localError.value = error instanceof Error ? error.message : t('auth.gate.unableToSignIn');
  } finally {
    submitting.value = false;
  }
}
</script>
