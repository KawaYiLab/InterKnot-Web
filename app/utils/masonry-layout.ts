export interface MasonryItem {
  key: string | number;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
  style: { width: string; transform: string };
}

export interface MasonryGeometry {
  columns: number;
  width: number;
  gap: number;
  left: number;
}

export interface MasonryLayout {
  items: MasonryItem[];
  columns: MasonryItem[][];
  totalHeight: number;
}

/** Retain the unchanged prefix when pages arrive or a measured height changes. */
export function createMasonryLayout<T>() {
  let geometry: MasonryGeometry | undefined;
  let sources: T[] = [];
  let current: MasonryLayout = { items: [], columns: [], totalHeight: 0 };
  const byKey = new Map<string | number, MasonryItem>();

  function update(
    items: readonly T[],
    next: MasonryGeometry,
    keyMapper: (item: T) => string | number,
    heightMapper: (item: T, key: string | number) => number,
    invalidFrom = Infinity,
  ): MasonryLayout {
    const geometryChanged = !geometry || geometry.columns !== next.columns
      || geometry.width !== next.width || geometry.gap !== next.gap
      || geometry.left !== next.left;
    let from = geometryChanged ? 0 : Math.min(invalidFrom, items.length);

    // Read keys even for unchanged references so reactive key edits invalidate
    // their positions. Unchanged pages never call heightMapper again.
    // A new object with the same dimensions updates its slot without relayout.
    for (let i = 0; i < from; i++) {
      const item = items[i]!;
      const key = keyMapper(item);
      const existing = current.items[i];
      if (sources[i] === item && existing?.key === key) continue;
      if (existing?.key === key && existing.height === heightMapper(item, key)) {
        sources[i] = item;
      } else {
        from = i;
        break;
      }
    }

    if (!geometryChanged && from === items.length && current.items.length === items.length) {
      return current;
    }

    for (let i = from; i < current.items.length; i++) byKey.delete(current.items[i]!.key);
    current.items.length = from;
    sources.length = from;

    const columns = geometryChanged
      ? Array.from({ length: next.columns }, () => [] as MasonryItem[])
      : current.columns;
    const columnHeights = columns.map((column) => {
      // Each column is ordered by source index as well as vertical position.
      let lo = 0;
      let hi = column.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (column[mid]!.index < from) lo = mid + 1;
        else hi = mid;
      }
      column.length = lo;
      const last = column[lo - 1];
      return last ? last.top + last.height + next.gap : 0;
    });

    for (let i = from; i < items.length; i++) {
      const source = items[i]!;
      const key = keyMapper(source);
      const height = heightMapper(source, key);
      let shortest = 0;
      for (let c = 1; c < columnHeights.length; c++) {
        if (columnHeights[c]! < columnHeights[shortest]!) shortest = c;
      }
      const top = columnHeights[shortest]!;
      const left = next.left + shortest * (next.width + next.gap);
      const item: MasonryItem = {
        key, index: i, top, left, width: next.width, height,
        style: { width: `${next.width}px`, transform: `translate(${left}px, ${top}px)` },
      };
      current.items.push(item);
      columns[shortest]!.push(item);
      byKey.set(key, item);
      sources.push(source);
      columnHeights[shortest] = top + height + next.gap;
    }

    geometry = next;
    current = {
      items: current.items,
      columns,
      totalHeight: Math.max(0, ...columnHeights) - (items.length ? next.gap : 0),
    };
    return current;
  }

  return { update, byKey };
}
