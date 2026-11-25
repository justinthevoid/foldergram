<template>
  <section class="family-devices grid gap-3" :aria-label="t('devices.title')">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h3 class="m-0 text-base font-semibold">{{ t('devices.title') }}</h3>
      <button class="btn-ghost min-h-11" type="button" :disabled="loading || busy" @click="load">{{ t('devices.refresh') }}</button>
    </div>
    <p class="m-0 text-sm text-muted">{{ t('devices.description') }}</p>
    <p v-if="loading" role="status" class="m-0 text-sm text-muted">{{ t('family.loading') }}</p>
    <p v-else-if="error" role="alert" class="m-0 text-sm text-red-500">{{ t(error) }}</p>
    <p v-else-if="!devices.length" class="m-0 text-sm text-muted">{{ t('devices.empty') }}</p>
    <div v-for="device in devices" :key="device.id" class="grid gap-2 rounded-xl border border-border p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="m-0 font-semibold">{{ t('devices.labels.' + device.label) }}</p>
          <p v-if="device.current" class="m-0 text-sm text-muted">{{ t('devices.current') }}</p>
          <p class="m-0 mt-1 text-xs text-muted">{{ t('devices.firstSeen', { date: date(device.firstSeenAt) }) }}</p>
          <p class="m-0 text-xs text-muted">{{ t('devices.expires', { date: date(device.expiresAt) }) }}</p>
        </div>
        <button v-if="!device.current && confirmId !== device.id" type="button" class="btn-ghost min-h-11 text-red-500" :disabled="busy || loading"
          @click="confirmId = device.id">{{ t('devices.disconnect') }}</button>
      </div>
      <div v-if="confirmId === device.id" class="grid gap-2 border-t border-border pt-3">
        <p class="m-0 text-sm">{{ t('devices.confirm') }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost min-h-11" :disabled="busy" @click="confirmId = null">{{ t('family.cancel') }}</button>
          <button type="button" class="btn-primary min-h-11" :disabled="busy" @click="disconnect(device.id)">{{ t('devices.disconnect') }}</button>
        </div>
      </div>
    </div>
    <p v-if="notice" role="status" class="m-0 text-sm text-muted">{{ t(notice) }}</p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestJson } from '../api/http';

const props = defineProps<{ memberId?: string }>();
interface Device { id: string; label: 'iphone' | 'ipad' | 'android' | 'windows' | 'mac' | 'linux' | 'browser'; firstSeenAt: number; expiresAt: number; current: boolean }
const { t, locale } = useI18n();
const devices = ref<Device[]>([]);
const loading = ref(false);
const busy = ref(false);
const confirmId = ref<string | null>(null);
const error = ref('');
const notice = ref('');
const path = props.memberId ? '/api/admin/family/' + encodeURIComponent(props.memberId) + '/devices' : '/api/family/devices';
let alive = true;
let controller: AbortController | null = null;
const date = (timestamp: number) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(timestamp);
async function load() {
  if (loading.value || busy.value) return;
  loading.value = true;
  error.value = '';
  controller = new AbortController();
  try {
    const result = await requestJson<{ items: Device[] }>(path, { signal: controller.signal });
    if (alive) devices.value = result.items;
  } catch {
    if (alive) error.value = 'devices.loadError';
  } finally {
    if (alive) loading.value = false;
    controller = null;
  }
}
async function disconnect(id: string) {
  if (busy.value || loading.value || confirmId.value !== id) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  controller = new AbortController();
  try {
    await requestJson(path + '/' + encodeURIComponent(id), { method: 'DELETE', signal: controller.signal });
    if (alive) {
      devices.value = devices.value.filter(device => device.id !== id);
      confirmId.value = null;
      notice.value = 'devices.disconnected';
    }
  } catch {
    if (alive) error.value = 'devices.disconnectError';
  } finally {
    if (alive) busy.value = false;
    controller = null;
  }
}
onMounted(() => { void load(); });
onBeforeUnmount(() => { alive = false; controller?.abort(); devices.value = []; });
</script>
