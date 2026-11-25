<template>
  <section v-if="auth.canAccessSettings" class="card grid gap-4 p-6">
    <header>
      <h2 class="m-0 text-[1.18rem]">{{ t('family.title') }}</h2>
      <p class="m-0 mt-1 text-muted">{{ t('family.description') }}</p>
    </header>
    <p v-if="!auth.enabled || auth.accessMode === 'public'" class="m-0 rounded-xl border border-border bg-surface-alt p-4 text-sm">{{ t('family.protectFirst') }}</p>
    <template v-else>
      <p v-if="!https" class="m-0 text-sm text-muted">{{ t('family.httpsHelp') }}</p>
      <form class="flex flex-wrap gap-3 items-end" @submit.prevent="create">
        <label class="flex-1 min-w-[10rem] grid gap-1 text-sm font-medium">
          {{ t('family.name') }}
          <input v-model="name" maxlength="80" required class="border border-border rounded-lg p-3 bg-surface text-text" :disabled="disabled || !https" />
        </label>
        <button class="btn-primary" :disabled="disabled || !enabled || !https || !name.trim()" type="submit">{{ t('family.create') }}</button>
      </form>
      <div v-if="invite" class="grid gap-2 rounded-xl border border-border bg-surface-alt p-4">
        <p class="m-0 font-semibold">{{ t('family.linkFor', { name: invite.member.name }) }}</p>
        <p class="m-0 text-sm text-muted">{{ t('family.linkHelp') }}</p>
        <label v-if="externalOrigin" class="grid gap-1 text-sm font-medium">
          {{ t('family.destination') }}
          <select v-model="inviteDestination" class="rounded-lg border border-border bg-surface text-text p-2" @change="copied = false">
            <option value="external">{{ t('family.externalLink') }}</option>
            <option value="private">{{ t('family.privateLink') }}</option>
          </select>
        </label>
        <p v-if="externalOrigin && inviteDestination === 'external'" class="m-0 text-sm text-muted">{{ t('family.externalHelp') }}</p>
        <input :value="link" readonly :aria-label="t('family.invitation')" class="min-w-0 border border-border rounded-lg p-2 bg-surface text-text text-sm" @focus="($event.target as HTMLInputElement).select()" />
        <div class="flex flex-wrap gap-2">
          <button class="btn-primary" type="button" @click="copy">{{ t(copied ? 'family.copied' : 'family.copy') }}</button>
          <button class="rounded-lg border border-border px-3 py-2 text-sm font-medium" type="button" :aria-expanded="showCard" @click="showCard = !showCard">{{ t(showCard ? 'inviteCard.hide' : 'inviteCard.create') }}</button>
          <button class="px-3 py-2 text-sm font-medium text-muted" type="button" @click="invite = null">{{ t('family.dismiss') }}</button>
        </div>
      </div>
      <InvitationCard v-if="invite && showCard" :key="invite.token" :link="link" :recipient="invite.member.name" :expires-at="invite.expiresAt" />
      <p v-if="loading" class="m-0 text-sm text-muted">{{ t('family.loading') }}</p>
      <p v-else-if="!members.length" class="m-0 text-sm text-muted">{{ t('family.empty') }}</p>
      <div v-for="member in members" :key="member.id" class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div class="min-w-0">
          <p class="m-0 font-semibold break-words">{{ member.name }}</p>
          <p class="m-0 mt-1 text-sm text-muted">{{ t(member.revokedAt ? 'family.revoked' : member.inviteExpiresAt ? 'family.pending' : member.lastJoinedAt ? 'family.joined' : 'family.needsInvite') }}</p>
        </div>
        <div v-if="!member.revokedAt" class="flex flex-wrap gap-2">
          <button class="rounded-lg border border-border px-3 py-2 text-sm font-medium" type="button" :disabled="disabled || !enabled || !https" @click="renew(member)">{{ t('family.newLink') }}</button>
          <button class="btn-ghost min-h-11" type="button" :aria-expanded="devicesMemberId === member.id" :disabled="disabled" @click="devicesMemberId = devicesMemberId === member.id ? null : member.id">{{ t('devices.manage') }}</button>
          <button class="rounded-lg border border-border px-3 py-2 text-sm font-medium text-red-500" type="button" :disabled="disabled" @click="confirmId = member.id">{{ t('family.revoke') }}</button>
        </div>
        <FamilyDeviceSessions v-if="!member.revokedAt && devicesMemberId === member.id" :key="member.id" :member-id="member.id" class="w-full" />
        <div v-if="confirmId === member.id" class="w-full flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <p class="m-0 text-sm flex-1">{{ t('family.revokeHelp') }}</p>
          <button type="button" class="px-3 py-2 rounded-lg border border-border text-sm" @click="confirmId = null">{{ t('family.cancel') }}</button>
          <button type="button" class="btn-primary" :disabled="disabled" @click="revoke(member)">{{ t('family.confirmRevoke') }}</button>
        </div>
      </div>
      <p v-if="error" role="alert" class="m-0 text-sm text-red-500">{{ error }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { requestJson } from '../api/http';
import type { FamilyInvite, FamilyMember } from '../types/api';
const InvitationCard = defineAsyncComponent(() => import('./InvitationCard.vue'));
const FamilyDeviceSessions = defineAsyncComponent(() => import('./FamilyDeviceSessions.vue'));
const devicesMemberId = ref<string | null>(null);

const { t } = useI18n();
const auth = useAuthStore();
const name = ref('');
const members = ref<FamilyMember[]>([]);
const invite = ref<FamilyInvite | null>(null);
const externalOrigin = ref<string | null>(null);
const inviteDestination = ref<'external' | 'private'>('external');
const enabled = ref(false);
const loading = ref(false);
const busy = ref(false);
const copied = ref(false);
const showCard = ref(false);
watch(() => invite.value?.token, () => { showCard.value = false; });
const error = ref('');
const confirmId = ref<string | null>(null);
const https = window.location.protocol === 'https:';
const disabled = computed(() => loading.value || busy.value || !auth.canWriteAppearance);
const link = computed(() => invite.value ? new URL('/#family-invite=' + invite.value.token, inviteDestination.value === 'external' && externalOrigin.value ? externalOrigin.value : window.location.origin).href : '');
async function load() {
  if (!auth.enabled || auth.accessMode === 'public' || !auth.canAccessSettings) {
    members.value = []; invite.value = null; externalOrigin.value = null; enabled.value = false; return;
  }
  loading.value = true;
  try {
    const result = await requestJson<{ enabled: boolean; members: FamilyMember[]; externalOrigin?: string | null }>('/api/admin/family');
    if (!auth.canAccessSettings) return;
    members.value = result.members;
    enabled.value = result.enabled;
    externalOrigin.value = result.externalOrigin ?? null;
  } catch { error.value = t('family.loadError'); }
  finally { loading.value = false; }
}
watch(() => [auth.enabled, auth.accessMode, auth.canAccessSettings], () => { void load(); }, { immediate: true });
async function issue(path: string, payload?: { name: string }) {
  if (disabled.value || !enabled.value || !https) return;
  busy.value = true; error.value = ''; invite.value = null; copied.value = false;
  try {
    invite.value = await requestJson<FamilyInvite>(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {})
    });
    name.value = '';
    await load();
  } catch { error.value = t('family.actionError'); }
  finally { busy.value = false; }
}
function create() { return issue('/api/admin/family', { name: name.value.trim() }); }
function renew(member: FamilyMember) { return issue('/api/admin/family/' + encodeURIComponent(member.id) + '/invite'); }
async function revoke(member: FamilyMember) {
  if (disabled.value || confirmId.value !== member.id) return;
  busy.value = true; error.value = '';
  try {
    await requestJson('/api/admin/family/' + encodeURIComponent(member.id) + '/revoke', { method: 'POST' });
    if (invite.value?.member.id === member.id) invite.value = null;
    confirmId.value = null;
    await load();
  } catch { error.value = t('family.actionError'); }
  finally { busy.value = false; }
}
async function copy() {
  try { await navigator.clipboard.writeText(link.value); copied.value = true; }
  catch { error.value = t('family.copyError'); }
}
</script>