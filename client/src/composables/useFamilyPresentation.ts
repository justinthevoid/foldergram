import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';

/** Presentation only: permissions continue to be enforced by existing APIs. */
export function useFamilyPresentation() {
  const auth = useAuthStore();
  return computed(() => auth.ready && auth.enabled && auth.authenticated &&
    auth.role === 'viewer' && auth.likesMode === 'family' && !!auth.familyMember);
}