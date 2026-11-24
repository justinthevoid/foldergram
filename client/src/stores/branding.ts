import { defineStore } from 'pinia';
import { requestJson } from '../api/http';

export interface Branding {
  name: string;
  photographer: string;
  bio: string;
  logo: string;
}
export const defaultBranding: Branding = { name: 'Foldergram', photographer: '', bio: '', logo: '' };
export const useBrandingStore = defineStore('branding', {
  state: () => ({ value: { ...defaultBranding }, ready: false, profileRevision: 0 }),
  actions: {
    apply(value: Partial<Branding>) {
      this.value = { ...this.value, ...value };
      if (typeof document !== 'undefined') document.title = this.value.name;
    },
    async loadPublic() {
      try {
        const value = await requestJson<Pick<Branding, 'name' | 'logo'>>('/api/branding');
        if (typeof value.name === 'string' && typeof value.logo === 'string') this.apply(value);
      } catch { /* Default branding remains usable on older servers or outages. */ }
    },
    async loadProfile() {
      const revision = ++this.profileRevision;
      try {
        const value = await requestJson<Branding>('/api/branding/profile');
        if (revision === this.profileRevision && typeof value.name === 'string' && typeof value.bio === 'string') {
          this.apply(value);
          this.ready = true;
        }
      } catch { if (revision === this.profileRevision) this.clearProfile(); }
    },
    clearProfile() {
      this.profileRevision++;
      this.value = { ...this.value, photographer: '', bio: '' };
      this.ready = false;
    },
    async save(value: Branding) {
      const saved = await requestJson<Branding>('/api/admin/settings/branding', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
      });
      this.apply(saved);
      this.ready = true;
    }
  }
});