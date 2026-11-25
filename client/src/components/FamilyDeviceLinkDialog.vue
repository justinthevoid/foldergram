<template>
  <dialog ref="dialog" class="device-link" :aria-labelledby="headingId" @cancel.prevent="emit('close')">
    <header class="device-link__header">
      <h2 :id="headingId">{{ t('deviceLink.title') }}</h2>
      <button type="button" class="btn-ghost min-h-11" autofocus @click="emit('close')">{{ t('common.close') }}</button>
    </header>
    <div class="device-link__body">
      <FamilyDeviceSessions />
      <div class="border-t border-border pt-3 grid gap-2">
        <h3 class="m-0 text-base font-semibold">{{ t('deviceLink.add') }}</h3>
        <p class="m-0">{{ t('deviceLink.description') }}</p>
      </div>
      <p class="m-0 text-sm text-muted">{{ t('deviceLink.privateHelp') }}</p>
      <template v-if="link && !expired">
        <canvas v-show="qrReady" ref="canvas" class="device-link__qr" :aria-label="t('deviceLink.qrLabel')" role="img" />
        <p v-if="!qrReady" class="m-0 text-sm text-muted">{{ t('deviceLink.copyInstead') }}</p>
        <p class="m-0 text-sm text-muted">{{ t('deviceLink.expires', { time: formattedExpiry }) }}</p>
        <label class="grid gap-2 text-sm font-medium">
          {{ t('family.invitation') }}
          <input ref="linkInput" :value="link" readonly class="min-w-0 border border-border rounded-lg p-3 bg-surface text-text"
            @focus="($event.target as HTMLInputElement).select()" />
        </label>
        <button type="button" class="btn-primary min-h-11" @click="copy">{{ t(copied ? 'family.copied' : 'family.copy') }}</button>
      </template>
      <p v-if="expired" role="status" class="m-0 text-sm text-muted">{{ t('deviceLink.expired') }}</p>
      <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ t(error) }}</p>
      <button v-if="!link || expired" type="button" class="btn-primary min-h-11" :disabled="busy" @click="generate">
        {{ t(busy ? 'deviceLink.generating' : 'deviceLink.generate') }}
      </button>
    </div>
  </dialog>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import jsQR from 'jsqr';
import FamilyDeviceSessions from './FamilyDeviceSessions.vue';
import { requestJson } from '../api/http';
import { invitationQrRaster, invitationUrl } from '../utils/invitation-card';

const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();
const headingId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const linkInput = ref<HTMLInputElement | null>(null);
const link = ref('');
const expiresAt = ref(0);
const now = ref(Date.now());
const busy = ref(false);
const copied = ref(false);
const qrReady = ref(false);
const error = ref('');
const expired = computed(() => !!link.value && now.value >= expiresAt.value);
const formattedExpiry = computed(() => new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(expiresAt.value));
let alive = true;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

async function generate() {
  if (busy.value || (link.value && !expired.value)) return;
  busy.value = true;
  error.value = '';
  link.value = '';
  expiresAt.value = 0;
  qrReady.value = false;
  copied.value = false;
  const request = new AbortController();
  controller = request;
  try {
    const result = await requestJson<{ token: string; expiresAt: number; origin: string }>('/api/family/device-invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: request.signal
    });
    if (!alive || request.signal.aborted) return;
    const url = invitationUrl(new URL('/#family-invite=' + result.token, result.origin).href);
    if (window.location.protocol === 'https:' && url.origin !== window.location.origin) throw new Error('Wrong gallery address');
    now.value = Date.now();
    if (!Number.isFinite(result.expiresAt) || result.expiresAt <= now.value || result.expiresAt > now.value + 600000 + 5000) throw new Error('Invalid expiration');
    expiresAt.value = result.expiresAt;
    link.value = url.href;
    await nextTick();
    if (!alive || !canvas.value || Date.now() >= expiresAt.value) return;
    try {
      const qr = invitationQrRaster(link.value, 442);
      if (jsQR(qr.pixels, qr.width, qr.width, { inversionAttempts: 'dontInvert' })?.data !== link.value) return;
      canvas.value.width = canvas.value.height = qr.width;
      const ctx = canvas.value.getContext('2d');
      if (!ctx) return;
      const pixels = ctx.createImageData(qr.width, qr.width);
      pixels.data.set(qr.pixels);
      ctx.putImageData(pixels, 0, 0);
      qrReady.value = true;
    } catch { /* A valid link remains copyable if QR rendering is unavailable. */ }
  } catch {
    if (alive && !request.signal.aborted) error.value = 'deviceLink.failed';
  } finally {
    if (alive) busy.value = false;
    if (controller === request) controller = null;
  }
}

async function copy() {
  if (!link.value || Date.now() >= expiresAt.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(link.value);
    if (alive) copied.value = true;
  } catch {
    if (!alive) return;
    linkInput.value?.focus();
    linkInput.value?.select();
    error.value = 'family.copyError';
  }
}
onMounted(() => {
  dialog.value?.showModal();
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => {
  alive = false;
  controller?.abort();
  if (timer !== undefined) clearInterval(timer);
  link.value = '';
  if (dialog.value?.open) dialog.value.close();
});
</script>
<style scoped>
.device-link { margin: auto; padding: 0; width: min(440px, calc(100% - 24px)); max-height: calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); border: 1px solid var(--border); border-radius: 16px; background: var(--surface); color: var(--text); overflow: auto; }
.device-link::backdrop { background: rgba(0,0,0,.55); }
.device-link__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.device-link__header h2 { margin: 0; font-size: 1.1rem; font-weight: 650; }
.device-link__body { display: grid; gap: 14px; padding: 16px; }
.device-link__qr { display: block; width: min(100%, 260px); aspect-ratio: 1; height: auto; margin: auto; background: #fff; image-rendering: pixelated; }
.device-link__body p { line-height: 1.5; }
</style>
