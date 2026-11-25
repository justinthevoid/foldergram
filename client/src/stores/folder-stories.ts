import { defineStore } from 'pinia';

import { fetchFolderStories, fetchFolderStoryFeed } from '../api/gallery';
import { i18n } from '../locales';
import type { FeedItem, FolderStoriesPayload, RailCapsule } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface FolderStoriesState {
  currentFolderSlug: string | null;
  railGeneration: number;
  capsuleGeneration: number;
  requestedCapsuleId: string | null;
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  hasAvatarStory: boolean;
  avatarStoryId: string | null;
  items: RailCapsule[];
  highlights: RailCapsule[];
  loadingList: boolean;
  listError: string | null;
  currentStory: RailCapsule | null;
  currentImages: FeedItem[];
  currentPage: number;
  currentLimit: number;
  currentHasMore: boolean;
  loadingStory: boolean;
  storyError: string | null;
}

function createEmptyStoryRail(): Pick<
  FolderStoriesState,
  'railTitle' | 'railDescription' | 'railSingularLabel' | 'hasAvatarStory' | 'avatarStoryId' | 'items' | 'highlights'
> {
  return {
    railTitle: 'Stories',
    railDescription: 'Profile stories and highlights.',
    railSingularLabel: 'Story',
    hasAvatarStory: false,
    avatarStoryId: null,
    items: [],
    highlights: []
  };
}

function applyStoryRailPayload(state: FolderStoriesState, payload: FolderStoriesPayload) {
  state.railTitle = payload.railTitle;
  state.railDescription = payload.railDescription;
  state.railSingularLabel = payload.railSingularLabel;
  state.hasAvatarStory = payload.hasAvatarStory;
  state.avatarStoryId = payload.avatarStoryId;
  state.items = payload.items;
  state.highlights = payload.highlights;
}

function resetCurrentStoryState(state: FolderStoriesState) {
  state.capsuleGeneration++;
  state.requestedCapsuleId = null;
  state.currentStory = null;
  state.currentImages = [];
  state.currentPage = 1;
  state.currentHasMore = true;
  state.loadingStory = false;
  state.storyError = null;
}

export const useFolderStoriesStore = defineStore('folderStories', {
  state: (): FolderStoriesState => ({
    currentFolderSlug: null,
    railGeneration: 0,
    capsuleGeneration: 0,
    requestedCapsuleId: null,
    ...createEmptyStoryRail(),
    loadingList: false,
    listError: null,
    currentStory: null,
    currentImages: [],
    currentPage: 1,
    currentLimit: 18,
    currentHasMore: true,
    loadingStory: false,
    storyError: null
  }),
  getters: {
    currentCapsule: (state) => state.currentStory,
    currentError: (state) => state.storyError
  },
  actions: {
    reset() {
      this.railGeneration++;
      this.currentFolderSlug = null;
      Object.assign(this, createEmptyStoryRail());
      this.loadingList = false;
      this.listError = null;
      resetCurrentStoryState(this);
    },

    async fetchStories(slug: string, force = false) {
      if (this.loadingList && this.currentFolderSlug === slug) return;

      if (!force && this.currentFolderSlug === slug && this.items.length > 0 && this.listError === null) {
        return;
      }

      const generation = ++this.railGeneration;
      this.currentFolderSlug = slug;
      Object.assign(this, createEmptyStoryRail());
      resetCurrentStoryState(this);
      this.loadingList = true;
      this.listError = null;

      try {
        const payload = await fetchFolderStories(slug);
        if (generation !== this.railGeneration) return;
        applyStoryRailPayload(this, payload);
      } catch (error) {
        if (generation !== this.railGeneration) return;
        Object.assign(this, createEmptyStoryRail());
        this.listError = error instanceof Error ? error.message : i18n.global.t('errors.loadFolderStories');
      } finally {
        if (generation === this.railGeneration) this.loadingList = false;
      }
    },

    async loadCapsule(id: string, reset = true) {
      if (!this.currentFolderSlug || (this.loadingStory && this.requestedCapsuleId === id)) return;

      if (reset || this.requestedCapsuleId !== id) {
        this.currentStory = null;
        this.currentImages = [];
        this.currentPage = 1;
        this.currentHasMore = true;
      }

      this.requestedCapsuleId = id;
      const generation = ++this.capsuleGeneration;
      this.loadingStory = true;
      this.storyError = null;

      try {
        const payload = await fetchFolderStoryFeed(this.currentFolderSlug, id, this.currentPage, this.currentLimit);
        if (generation !== this.capsuleGeneration) return;
        this.railTitle = payload.railTitle;
        this.railDescription = payload.railDescription;
        this.railSingularLabel = payload.railSingularLabel;
        this.currentStory = payload.story;
        this.currentImages.push(...payload.items);
        this.currentPage += 1;
        this.currentHasMore = payload.hasMore;
      } catch (error) {
        if (generation === this.capsuleGeneration) this.storyError = error instanceof Error ? error.message : i18n.global.t('errors.loadStoryCapsule');
      } finally {
        if (generation === this.capsuleGeneration) this.loadingStory = false;
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.currentImages = updateCaptionInItems(this.currentImages, id, caption);
    }
  }
});
