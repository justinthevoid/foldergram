import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';

/** Presentation only; the family comments endpoint remains authoritative. */
export function useFamilyCommentScope() {
  const auth = useAuthStore();
  return computed(() => {
    if (!auth.ready || !auth.enabled || !auth.authenticated || auth.accessMode === 'public' || auth.publicDemoMode === true) return null;
    return auth.role === 'admin' ? 'admin' : auth.familyMember?.id ?? null;
  });
}