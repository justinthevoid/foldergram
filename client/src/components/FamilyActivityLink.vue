<template>
  <RouterLink v-if="allowed" :to="{name:'family-activity'}" class="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-sm font-medium">
    <span class="i-fluent-alert-24-regular w-5 h-5 shrink-0 text-muted" aria-hidden="true" />
    <span class="flex-1 min-w-0">{{ t('activity.title') }}</span>
    <span v-if="unread" class="rounded-full bg-surface-alt px-2 py-1 text-xs font-semibold">{{ t('activity.unreadCount',{count:unread}) }}</span>
    <span class="i-fluent-chevron-right-20-regular w-4 h-4 text-muted" aria-hidden="true" />
  </RouterLink>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { requestJson } from '../api/http';
const auth=useAuthStore();
const {t}=useI18n();
const allowed=computed(()=>auth.ready&&auth.enabled&&auth.authenticated&&auth.role==='admin'&&auth.accessMode!=='public'&&!auth.externalFamilyAccess);
const unread=ref(0);
let revision=0;
async function refresh(){
 const current=++revision;
 if(!allowed.value){unread.value=0;return;}
 try{const result=await requestJson<{unread:number}>('/api/admin/activity?limit=1');if(current===revision&&allowed.value)unread.value=result.unread;}
 catch{if(current===revision)unread.value=0;}
}
watch(allowed,()=>{void refresh();},{immediate:true});
onMounted(()=>window.addEventListener('focus',refresh));
onBeforeUnmount(()=>{revision++;window.removeEventListener('focus',refresh);});
</script>