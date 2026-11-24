import { defineStore } from 'pinia';
import { requestJson } from '../api/http';
import { useAuthStore } from './auth';

export const useFamilyReactionsStore = defineStore('family-reactions', {
  state: () => ({
    entries: {} as Record<number, { names: string[]; loadedAt: number }>,
    queued: [] as number[],
    pending: [] as number[],
    scheduled: false,
    generation: 0
  }),
  getters: {
    canView: () => {
      const auth = useAuthStore();
      return auth.ready && auth.enabled && auth.authenticated && auth.role === 'admin' && auth.accessMode !== 'public';
    }
  },
  actions: {
    reset() {
      this.generation++;
      this.entries = {};
      this.queued = [];
      this.pending = [];
      this.scheduled = false;
    },
    load(id: number, force = false) {
      if (!this.canView || !Number.isSafeInteger(id) || id <= 0) return;
      if (this.queued.includes(id) || this.pending.includes(id)) return;
      if (!force && this.entries[id] && Date.now() - this.entries[id]!.loadedAt < 30000) return;
      this.queued.push(id);
      if (!this.scheduled) {
        this.scheduled = true;
        const generation = this.generation;
        queueMicrotask(() => {
          if (generation === this.generation) void this.flush();
        });
      }
    },
    async flush() {
      this.scheduled = false;
      if (!this.canView) { this.reset(); return; }
      const ids = this.queued.splice(0, 60);
      if (!ids.length) return;
      this.pending.push(...ids);
      const generation = this.generation;
      if (this.queued.length) {
        this.scheduled = true;
        queueMicrotask(() => { if (generation === this.generation) void this.flush(); });
      }
      try {
        const result = await requestJson<{ items: Record<string, string[]> }>('/api/admin/family/reactions?ids=' + ids.join(','));
        if (generation !== this.generation || !this.canView) return;
        for (const id of ids) {
          const names = result.items[String(id)];
          if (Array.isArray(names) && names.every(name => typeof name === 'string')) {
            this.entries[id] = { names, loadedAt: Date.now() };
          }
        }
      } catch {
        // The gallery remains usable if reaction summaries are unavailable.
      } finally {
        if (generation === this.generation) this.pending = this.pending.filter(id => !ids.includes(id));
      }
    }
  }
});