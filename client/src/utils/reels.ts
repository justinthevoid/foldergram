export interface ReelPanelMetrics {
  id: number;
  offsetTop: number;
  offsetHeight: number;
}

export interface ReelsAffinitySnapshot {
  lastFolder: string | null;
  recentFolders: string[];
}

export function resolveReelsAffinitySnapshot(
  existingSnapshot: ReelsAffinitySnapshot | null,
  lastFolder: string | null,
  recentFolders: string[]
): ReelsAffinitySnapshot {
  if (existingSnapshot) {
    return existingSnapshot;
  }

  const normalizedLastFolder = typeof lastFolder === 'string' && lastFolder.trim().length > 0 ? lastFolder.trim() : null;
  const normalizedRecentFolders = recentFolders
    .map((folder) => folder.trim())
    .filter((folder, index, items) => folder.length > 0 && items.indexOf(folder) === index);

  return {
    lastFolder: normalizedLastFolder,
    recentFolders: normalizedLastFolder
      ? [normalizedLastFolder, ...normalizedRecentFolders.filter((folder) => folder !== normalizedLastFolder)]
      : normalizedRecentFolders
  };
}

export function getActiveReelIdByIndex(
  panelCount: number,
  getPanel: (index: number) => ReelPanelMetrics | null,
  scrollTop: number,
  viewportHeight: number
): number | null {
  if (panelCount <= 0) return null;

  const viewportCenter = scrollTop + viewportHeight / 2;
  let low = 0;
  let high = panelCount;

  // Reel panels follow DOM order and have monotonically increasing centers.
  // Find the first center at or after the viewport center in O(log n).
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const panel = getPanel(middle);
    if (!panel) return null;
    const panelCenter = panel.offsetTop + panel.offsetHeight / 2;
    if (panelCenter < viewportCenter) low = middle + 1;
    else high = middle;
  }

  const before = low > 0 ? getPanel(low - 1) : null;
  const after = low < panelCount ? getPanel(low) : null;
  if (!before) return after?.id ?? null;
  if (!after) return before.id;

  const beforeOffset = Math.abs(before.offsetTop + before.offsetHeight / 2 - viewportCenter);
  const afterOffset = Math.abs(after.offsetTop + after.offsetHeight / 2 - viewportCenter);
  return beforeOffset <= afterOffset ? before.id : after.id;
}

export function getActiveReelId(
  panels: ReelPanelMetrics[],
  scrollTop: number,
  viewportHeight: number
): number | null {
  return getActiveReelIdByIndex(panels.length, index => panels[index] ?? null, scrollTop, viewportHeight);
}

export function shouldPrefetchReels(activeIndex: number, totalItems: number, remainingThreshold = 3): boolean {
  if (activeIndex < 0 || totalItems <= 0) {
    return false;
  }

  return activeIndex >= totalItems - remainingThreshold;
}
