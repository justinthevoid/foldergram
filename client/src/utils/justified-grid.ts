type Dimensions = { width: number; height: number };
type Tile = { width: number; height: number };

// Preserve item order and natural proportions. Fill complete rows, but never
// stretch the unfinished final row beyond the preferred row height.
export function justifiedTiles(items: Dimensions[], width: number, target: number, gap: number): Tile[] {
  const tiles: Tile[] = [];
  if (!items.length || !Number.isFinite(width) || width <= 0) return tiles;
  const ratios = items.map(item => {
    const ratio = item.width / item.height;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  });
  let row: number[] = [];
  let sum = 0;
  const heightFor = (count: number, total: number) => Math.max(0.1, (width - gap * (count - 1)) / total);
  const finish = (complete: boolean) => {
    if (!row.length) return;
    const height = complete ? heightFor(row.length, sum) : Math.min(target, heightFor(row.length, sum));
    // Reserve a subpixel per tile so browser rounding cannot wrap a full row.
    for (const ratio of row) {
      tiles.push({ width: Math.max(0.1, ratio * height - 0.05), height });
    }
    row = [];
    sum = 0;
  };
  for (const ratio of ratios) {
    if (row.length && heightFor(row.length + 1, sum + ratio) < target) {
      const before = heightFor(row.length, sum);
      const after = heightFor(row.length + 1, sum + ratio);
      if (Math.abs(before - target) < Math.abs(after - target)) finish(true);
    }
    row.push(ratio);
    sum += ratio;
    if (heightFor(row.length, sum) <= target) finish(true);
  }
  finish(false);
  return tiles;
}