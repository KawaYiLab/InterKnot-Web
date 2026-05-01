<script lang="ts">
/**
 * VirtualMasonry – 带虚拟化的瀑布流布局
 *
 * 只渲染视口 ± buffer 范围内的卡片，DOM 节点数恒定。
 * 未测量过的 item 用 estimatedHeight 占位，测量后缓存真实高度。
 */
const DEFAULT_ESTIMATED_HEIGHT = 340;
</script>

<script setup lang="ts" generic="T">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type StyleValue,
} from "vue";

/* ── Props ────────────────────────────────────── */
const props = withDefaults(
  defineProps<{
    items: T[];
    keyMapper: (item: T) => string | number;
    columnWidth?: number;
    gap?: number;
    minColumns?: number;
    maxColumns?: number;
    buffer?: number;
    estimatedHeight?: number;
    heightMapper?: (item: T, itemWidth: number) => number | undefined;
    measureItems?: boolean;
  }>(),
  {
    columnWidth: 240,
    gap: 16,
    minColumns: 2,
    maxColumns: 6,
    buffer: 600,
    estimatedHeight: DEFAULT_ESTIMATED_HEIGHT,
    measureItems: true,
  },
);

/* ── Refs ─────────────────────────────────────── */
const containerRef = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
const scrollY = ref(0);
const viewportH = ref(0);
// 缓存容器相对文档顶部的偏移，避免在 computed 中调用 getBoundingClientRect
const containerOffsetY = ref(0);
// 滚动方向：1 = 向下, -1 = 向上
const scrollDirection = ref(1);

// 缓存已测量的 item 高度 (key → px)
const measuredHeights = new Map<string | number, number>();
// 缓存 heightMapper 计算结果 (key → px)，colW 变化时清空
const mappedHeightCache = new Map<string | number, number>();
let _cachedColW = 0;
// 当前正在被 ResizeObserver 跟踪的元素
const observedElements = new Map<Element, string | number>();
// 高度版本号，变化时触发重新计算布局
const heightVersion = ref(0);

let resizeObserver: ResizeObserver | null = null;
let containerResizeObserver: ResizeObserver | null = null;
let scrollRAF: number | null = null;
let resizeRAF: number | null = null;
let _prevScrollY = 0;

const isMounted = ref(false);

/* ── 列数 ─────────────────────────────────────── */
const columnCount = computed(() => {
  const w = containerWidth.value;
  if (w <= 0) return props.minColumns;
  const cols = Math.floor((w + props.gap) / (props.columnWidth + props.gap));
  return Math.max(props.minColumns, Math.min(props.maxColumns, cols));
});

const actualColumnWidth = computed(() => {
  const cols = columnCount.value;
  const totalGap = (cols - 1) * props.gap;
  return (containerWidth.value - totalGap) / cols;
});

/* ── 布局计算 ──────────────────────────────────── */
interface LayoutItem {
  key: string | number;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

const layout = computed((): {
  items: LayoutItem[];
  columns: LayoutItem[][];
  totalHeight: number;
} => {
  // 触发对 heightVersion 的依赖追踪
  void heightVersion.value;

  const cols = columnCount.value;
  const colW = actualColumnWidth.value;
  const gap = props.gap;

  if (cols <= 0 || colW <= 0) {
    return { items: [], columns: [], totalHeight: 0 };
  }

  // colW 变化时清空 heightMapper 缓存
  if (colW !== _cachedColW) {
    mappedHeightCache.clear();
    _cachedColW = colW;
  }

  const colHeights = new Array<number>(cols).fill(0);
  const columns = Array.from({ length: cols }, () => [] as LayoutItem[]);
  const result: LayoutItem[] = [];

  for (let i = 0; i < props.items.length; i++) {
    const item = props.items[i];
    if (!item) continue;
    const key = props.keyMapper(item);

    // 使用缓存的 heightMapper 结果，避免重复计算
    let stableMappedHeight: number | undefined;
    if (props.heightMapper) {
      const cached = mappedHeightCache.get(key);
      if (cached !== undefined) {
        stableMappedHeight = cached;
      } else {
        const mappedHeight = props.heightMapper(item, colW);
        if (typeof mappedHeight === "number" && Number.isFinite(mappedHeight) && mappedHeight > 0) {
          stableMappedHeight = mappedHeight;
          mappedHeightCache.set(key, mappedHeight);
        }
      }
    }

    const h = (props.measureItems ? measuredHeights.get(key) : undefined)
      ?? stableMappedHeight
      ?? props.estimatedHeight;

    // 找最短列
    let minCol = 0;
    for (let c = 1; c < cols; c++) {
      if ((colHeights[c] ?? 0) < (colHeights[minCol] ?? 0)) minCol = c;
    }

    const top = colHeights[minCol] ?? 0;
    const left = minCol * (colW + gap);

    const layoutItem = { key, index: i, top, left, width: colW, height: h };
    result.push(layoutItem);
    columns[minCol]?.push(layoutItem);
    colHeights[minCol] = top + h + gap;
  }

  const totalHeight = Math.max(...colHeights, 0);
  return { items: result, columns, totalHeight };
});

function findFirstColumnItem(
  items: LayoutItem[],
  viewportTop: number,
  containerOffset: number,
) {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const item = items[mid];
    if (!item) {
      high = mid;
      continue;
    }

    const itemBottom = containerOffset + item.top + item.height;
    if (itemBottom < viewportTop) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/* ── 虚拟视口裁剪 ─────────────────────────────── */
const visibleItems = computed(() => {
  const sy = scrollY.value;
  const vh = viewportH.value;
  const buf = props.buffer;
  const dir = scrollDirection.value;

  // 根据滚动方向使用非对称缓冲区：滚动方向 1.6x，反方向 0.6x
  const bufAbove = dir >= 0 ? buf * 0.6 : buf * 1.6;
  const bufBelow = dir >= 0 ? buf * 1.6 : buf * 0.6;
  const top = sy - bufAbove;
  const bottom = sy + vh + bufBelow;

  // 使用缓存的容器偏移，不再调用 getBoundingClientRect
  const containerOffset = containerOffsetY.value;

  const visible: LayoutItem[] = [];
  const columns = layout.value.columns;

  for (const columnItems of columns) {
    const startIndex = findFirstColumnItem(columnItems, top, containerOffset);

    for (let i = startIndex; i < columnItems.length; i++) {
      const item = columnItems[i];
      if (!item) continue;

      const itemTop = containerOffset + item.top;
      if (itemTop > bottom) break;

      visible.push(item);
    }
  }

  return visible;
});

/* ── SSR: 渲染所有 item，不做虚拟化裁剪 ─────── */
const ssrItems = computed((): LayoutItem[] => {
  return props.items.map((item, index) => ({
    key: props.keyMapper(item),
    index,
    top: 0,
    left: 0,
    width: props.columnWidth,
    height: props.estimatedHeight,
  }));
});

const displayItems = computed(() => {
  if (!isMounted.value) return ssrItems.value;
  return visibleItems.value;
});

/* ── 容器与 item 的样式 ────────────────────────── */
const ssrContainerStyle = computed<StyleValue>(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.columnWidth}px, 1fr))`,
  gap: `${props.gap}px`,
  width: "100%",
}));

const containerStyle = computed<StyleValue>(() => ({
  position: "relative" as const,
  width: "100%",
  height: `${layout.value.totalHeight}px`,
}));

function itemStyle(it: LayoutItem): StyleValue {
  return {
    position: "absolute" as const,
    top: "0",
    left: "0",
    width: `${it.width}px`,
    transform: `translate(${it.left}px, ${it.top}px)`,
    contain: "layout style paint",
  };
}

/* ── 获取原始 item 对象 ────────────────────────── */
function getItem(layoutItem: LayoutItem): T {
  return props.items[layoutItem.index] as T;
}

/* ── 滚动监听 ──────────────────────────────────── */
function updateContainerOffset() {
  if (containerRef.value) {
    containerOffsetY.value = window.scrollY + containerRef.value.getBoundingClientRect().top;
  }
}

function onScroll() {
  // 取消前一帧的 rAF 并重新调度，确保使用最新滚动位置
  if (scrollRAF !== null) cancelAnimationFrame(scrollRAF);
  scrollRAF = requestAnimationFrame(() => {
    const currentY = window.scrollY;
    // 更新滚动方向（仅在方向实际翻转时写入）
    if (currentY !== _prevScrollY) {
      const dir = currentY > _prevScrollY ? 1 : -1;
      if (scrollDirection.value !== dir) scrollDirection.value = dir;
      _prevScrollY = currentY;
    }
    scrollY.value = currentY;
    const vh = window.innerHeight;
    if (viewportH.value !== vh) viewportH.value = vh;
    scrollRAF = null;
  });
}

/* ── ResizeObserver: 测量 item 真实高度 ────────── */
function setupResizeObserver() {
  if (!props.measureItems) return;

  resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const key = observedElements.get(entry.target);
      if (key === undefined) continue;
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const rounded = Math.round(h);
      if (measuredHeights.get(key) !== rounded) {
        measuredHeights.set(key, rounded);
        changed = true;
      }
    }
    if (changed) {
      heightVersion.value++;
    }
  });
}

function observeItem(el: Element, key: string | number) {
  if (!props.measureItems) return;
  if (!resizeObserver) return;
  observedElements.set(el, key);
  resizeObserver.observe(el, { box: "border-box" });
}

function unobserveItem(el: Element) {
  if (!props.measureItems) return;
  if (!resizeObserver) return;
  observedElements.delete(el);
  resizeObserver.unobserve(el);
}

/* ── 容器宽度监听 ──────────────────────────────── */
function setupContainerResize() {
  if (!containerRef.value) return;
  containerResizeObserver = new ResizeObserver(() => {
    if (resizeRAF !== null) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
      resizeRAF = null;
      if (containerRef.value) {
        containerWidth.value = containerRef.value.clientWidth;
        updateContainerOffset();
      }
    });
  });
  containerResizeObserver.observe(containerRef.value);
  containerWidth.value = containerRef.value.clientWidth;
}

/* ── item-ref 回调 (供模板使用) ─────────────────── */
const itemRefMap = new Map<string | number, Element>();

function setItemRef(el: Element | null, key: string | number) {
  if (!props.measureItems) return;

  const existing = itemRefMap.get(key);
  if (existing && existing !== el) {
    unobserveItem(existing);
    itemRefMap.delete(key);
  }
  if (el) {
    itemRefMap.set(key, el);
    observeItem(el, key);
  }
}

function cleanupRemovedRefs(activeKeys: Set<string | number>) {
  for (const [key, el] of itemRefMap) {
    if (!activeKeys.has(key)) {
      unobserveItem(el);
      itemRefMap.delete(key);
    }
  }
}

// items 引用变化时，清理不再存在的缓存
watch(
  () => props.items,
  (newItems, oldItems) => {
    if (!oldItems || newItems.length === 0) {
      measuredHeights.clear();
      mappedHeightCache.clear();
      return;
    }
    // 列表被整体替换时（首 key 不同），清空缓存
    const newFirst = newItems[0] ? props.keyMapper(newItems[0]) : undefined;
    const oldFirst = oldItems[0] ? props.keyMapper(oldItems[0]) : undefined;
    if (newFirst !== oldFirst) {
      measuredHeights.clear();
      mappedHeightCache.clear();
    }
  },
);

// 每次 visibleItems 变化时，清理已离开虚拟视口的 observer
watch(
  () => visibleItems.value,
  (items) => {
    if (!props.measureItems) return;
    const activeKeys = new Set(items.map((it) => it.key));
    cleanupRemovedRefs(activeKeys);
  },
  { flush: "post" },
);

/* ── 生命周期 ──────────────────────────────────── */
onMounted(async () => {
  scrollY.value = window.scrollY;
  _prevScrollY = window.scrollY;
  viewportH.value = window.innerHeight;
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  setupResizeObserver();
  await nextTick();
  setupContainerResize();
  updateContainerOffset();
  isMounted.value = true;
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  if (scrollRAF !== null) cancelAnimationFrame(scrollRAF);
  if (resizeRAF !== null) cancelAnimationFrame(resizeRAF);
  resizeObserver?.disconnect();
  containerResizeObserver?.disconnect();
  observedElements.clear();
  itemRefMap.clear();
  mappedHeightCache.clear();
});

/* ── Expose ───────────────────────────────────── */
defineExpose({ measuredHeights });
</script>

<template>
  <div ref="containerRef" :style="isMounted ? containerStyle : ssrContainerStyle">
    <div
      v-for="layoutItem in displayItems"
      :key="layoutItem.key"
      :ref="(el: any) => { if (isMounted) setItemRef(el as Element, layoutItem.key) }"
      :style="isMounted ? itemStyle(layoutItem) : undefined"
    >
      <slot
        :item="getItem(layoutItem)"
        :index="layoutItem.index"
        :width="layoutItem.width"
      />
    </div>
  </div>
</template>
