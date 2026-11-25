import { describe, expect, it } from 'vitest';
import { getActiveReelId, getActiveReelIdByIndex, type ReelPanelMetrics } from './reels';

function createPanels(count: number): ReelPanelMetrics[] {
  const panels: ReelPanelMetrics[] = [];
  let offsetTop = 0;
  for (let index = 0; index < count; index += 1) {
    const offsetHeight = 480 + (index % 9) * 43;
    panels.push({ id: index + 1, offsetTop, offsetHeight });
    offsetTop += offsetHeight + (index % 3) * 12;
  }
  return panels;
}

function linearActive(panels: ReelPanelMetrics[], scrollTop: number, viewportHeight: number) {
  const center = scrollTop + viewportHeight / 2;
  let result: ReelPanelMetrics | null = panels[0] ?? null;
  let distance = Number.POSITIVE_INFINITY;
  for (const panel of panels) {
    const next = Math.abs(panel.offsetTop + panel.offsetHeight / 2 - center);
    if (next < distance) {
      distance = next;
      result = panel;
    }
  }
  return result?.id ?? null;
}

describe('Reel active panel lookup', () => {
  it('matches the nearest panel across variable heights and viewport positions', () => {
    const panels = createPanels(1024);
    const getPanel = (index: number) => panels[index] ?? null;
    const totalHeight = panels.at(-1)!.offsetTop + panels.at(-1)!.offsetHeight;
    for (let scrollTop = 0; scrollTop < totalHeight; scrollTop += 127) {
      const expected = linearActive(panels, scrollTop, 740);
      expect(getActiveReelIdByIndex(panels.length, getPanel, scrollTop, 740)).toBe(expected);
      expect(getActiveReelId(panels, scrollTop, 740)).toBe(expected);
    }
  });

  it('uses logarithmic panel reads for a large queue', () => {
    const panels = createPanels(1024);
    let reads = 0;
    const getPanel = (index: number) => {
      reads += 1;
      return panels[index] ?? null;
    };
    const expected = linearActive(panels, panels[777]!.offsetTop + 120, 740);
    expect(getActiveReelIdByIndex(panels.length, getPanel, panels[777]!.offsetTop + 120, 740)).toBe(expected);
    expect(reads).toBeLessThanOrEqual(13);
  });

  it('handles empty queues and first/last panel boundaries', () => {
    let reads = 0;
    expect(getActiveReelIdByIndex(0, () => { reads += 1; return null; }, 0, 800)).toBeNull();
    expect(reads).toBe(0);
    const panels = createPanels(3);
    expect(getActiveReelIdByIndex(3, index => panels[index] ?? null, 0, 800)).toBe(1);
    const last = panels[2]!;
    expect(getActiveReelIdByIndex(3, index => panels[index] ?? null, last.offsetTop + last.offsetHeight, 800)).toBe(3);
  });
});
