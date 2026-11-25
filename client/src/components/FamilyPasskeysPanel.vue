<template>
  <section class="grid gap-3" :aria-label="t('passkeys.title')">
    <h3 class="m-0 text-base font-semibold">{{ t('passkeys.title') }}</h3>
    <p class="m-0 text-sm text-muted">{{ t('passkeys.description') }}</p>
    <p v-if="loading" role="status" class="m-0 text-sm text-muted">{{ t('family.loading') }}</p>
    <p v-else-if="!keys.length && !error" class="m-0 text-sm text-muted">{{ t('passkeys.empty') }}</p>
    <div v-for="key in keys" :key="key.id" class="grid gap-2 rounded-xl border border-border p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="m-0 font-semibold">{{ t('devices.labels.' + key.label) }}</p>
          <p class="m-0 text-xs text-muted">{{ t('passkeys.created', { date: date(key.createdAt) }) }}</p>
          <p v-if="key.lastUsedAt" class="m-0 text-xs text-muted">{{ t('passkeys.used', { date: date(key.lastUsedAt) }) }}</p>
          <p v-if="key.backedUp" class="m-0 text-xs text-muted">{{ t('passkeys.backedUp') }}</p>
        </div>
        <button v-if="confirmId !== key.id" type="button" class="btn-ghost min-h-11 text-red-500" :disabled="busy || loading"
          @click="confirmId = key.id">{{ t('passkeys.remove') }}</button>
      </div>
      <div v-if="confirmId === key.id" class="grid gap-2 border-t border-border pt-3">
        <p class="m-0 text-sm">{{ t('passkeys.confirm') }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost min-h-11" :disabled="busy" @click="confirmId = null">{{ t('family.cancel') }}</button>
          <button type="button" class="btn-primary min-h-11" :disabled="busy" @click="remove(key.id)">{{ t('passkeys.remove') }}</button>
        </div>
      </div>
    </div>
    <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ t(error) }}</p>
    <p v-if="notice" role="status" class="m-0 text-sm text-muted">{{ t(notice) }}</p>
    <button v-if="!memberId && supported" type="button" class="btn-primary min-h-11" :disabled="busy || loading" @click="enroll">
      {{ t(busy ? 'passkeys.working' : 'passkeys.setup') }}
    </button>
    <p v-else-if="!memberId" class="m-0 text-sm text-muted">{{ t('passkeys.unsupported') }}</p>
    <button v-if="error && !busy" type="button" class="btn-ghost min-h-11" @click="load">{{ t('devices.refresh') }}</button>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestJson } from '../api/http';
import { enrollFamilyPasskey, supportsFamilyPasskeys } from '../utils/family-passkeys';

const props = defineProps<{ memberId?: string }>();
interface Passkey { id: string; label: string; createdAt: number; lastUsedAt: number | null; backedUp: boolean; synced: boolean }
const { t, locale } = useI18n();
const supported = supportsFamilyPasskeys();
const keys = ref<Passkey[]>([]);
const loading = ref(false);
const busy = ref(false);
const confirmId = ref<string | null>(null);
const error = ref('');
const notice = ref('');
const path = props.memberId ? '/api/admin/family/' + encodeURIComponent(props.memberId) + '/passkeys' : '/api/family/passkeys';
let alive = true;
let controller: AbortController | null = null;
const date = (timestamp: number) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(timestamp);
async function refresh(signal: AbortSignal) {
  const result = await requestJson<{ items: Passkey[] }>(path, { signal });
  if (alive) keys.value = result.items;
}
async function load() {
  if (loading.value || busy.value) return;
  loading.value = true; error.value = '';
  controller = new AbortController();
  try { await refresh(controller.signal); }
  catch { if (alive) error.value = 'passkeys.loadError'; }
  finally { if (alive) loading.value = false; controller = null; }
}
async function enroll() {
  if (props.memberId || !supported || loading.value || busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  controller = new AbortController();
  try {
    const result = await enrollFamilyPasskey(controller.signal);
    if (!alive) return;
    if (!result.ok) throw new Error('Passkey not registered');
    notice.value = 'passkeys.saved';
    await refresh(controller.signal);
  } catch { if (alive) error.value = 'passkeys.setupError'; }
  finally { if (alive) busy.value = false; controller = null; }
}
async function remove(id: string) {
  if (busy.value || loading.value || confirmId.value !== id) return;
  busy.value = true; error.value = ''; notice.value = '';
  controller = new AbortController();
  try {
    await requestJson(path + '/' + encodeURIComponent(id), { method: 'DELETE', signal: controller.signal });
    if (alive) { keys.value = keys.value.filter(key => key.id !== id); confirmId.value = null; notice.value = 'passkeys.removed'; }
  } catch { if (alive) error.value = 'passkeys.removeError'; }
  finally { if (alive) busy.value = false; controller = null; }
}
onMounted(() => { void load(); });
onBeforeUnmount(() => { alive = false; controller?.abort(); keys.value = []; });
</script>
