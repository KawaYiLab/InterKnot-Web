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
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { createMasonryLayout, type MasonryItem } from "~/utils/masonry-layout";

/* ── Props ────────────────────────────────────── */
const props = withDefaults(
  defineProps<{
    items: T[];
    keyMapper: (item: T) => string | number;
    columnWidth?: number;
    maxColumnWidth?: number;
    gap?: number;
    minColumns?: number;
    maxColumns?: number;
    buffer?: number;
    estimatedHeight?: number;
    heightMapper?: (item: T, itemWidth: number) => number | undefined;
    measureItems?: boolean;
    /** 预填充的已测量高度，用于列表重建时跳过"估算→测量"阶段，实现精确滚动恢复 */
    initialHeights?: Iterable<readonly [string | number, number]>;
    /** initialHeights 对应的列宽；跨路由改变屏宽后不使用旧尺寸。 */
    initialWidth?: number;
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

// 缓存已测量的 item 高度 (key → px)；支持通过 initialHeights prop 预填充，
// 使列表重建后能跳过"估算 → 测量"过程，直接用真实高度计算布局。
const measuredHeights = new Map<string | number, number>(props.initialHeights);
// 缓存 heightMapper 计算结果 (key → px)，colW 变化时清空
const mappedHeightCache = new Map<string | number, { item: T; height: number | undefined }>();
const positioner = createMasonryLayout<T>();
let dirtyFrom = Infinity;
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
// 累计同方向位移，超过阈值才翻转 scrollDirection，避免惯性滚动末段抖动导致 buffer 频繁切换
let _directionAccum = 0;
const DIRECTION_FLIP_THRESHOLD = 24;

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
  const stretched = (containerWidth.value - totalGap) / cols;
  if (props.maxColumnWidth && stretched > props.maxColumnWidth) {
    return props.maxColumnWidth;
  }
  return stretched;
});

// 当列宽被 maxColumnWidth 钳制时，整体在容器中居中，留白分摊到两侧
const contentLeftOffset = computed(() => {
  const cols = columnCount.value;
  const colW = actualColumnWidth.value;
  const usedWidth = cols * colW + (cols - 1) * props.gap;
  const remainder = containerWidth.value - usedWidth;
  return remainder > 0 ? remainder / 2 : 0;
});

/* ── 布局计算 ──────────────────────────────────── */
function resolveHeight(item: T, key: string | number) {
  let cached = mappedHeightCache.get(key);
  if (!cached || cached.item !== item) {
    const mapped = props.heightMapper?.(item, actualColumnWidth.value);
    const height = typeof mapped === "number" && Number.isFinite(mapped) && mapped > 0
      ? mapped : undefined;
    // Mounted cards are measured by RO. Offscreen edits need fresh estimates only
    // when their dimensions changed; read status/count updates retain measurements.
    if (cached && cached.height !== height && !itemRefMap.has(key)) measuredHeights.delete(key);
    cached = { item, height };
    mappedHeightCache.set(key, cached);
  }
  return (props.measureItems ? measuredHeights.get(key) : undefined)
    ?? cached.height ?? props.estimatedHeight;
}

const layout = computed(() => {
  void heightVersion.value;
  const cols = columnCount.value;
  const colW = actualColumnWidth.value;
  if (cols <= 0 || colW <= 0) return { items: [], columns: [], totalHeight: 0 };

  if (colW !== _cachedColW) {
    mappedHeightCache.clear();
    // An existing measurement belongs to one column width. Keep initial values
    // on the first layout only when their saved width is compatible.
    if (_cachedColW > 0 || (props.initialWidth !== undefined && props.initialWidth !== colW)) {
      measuredHeights.clear();
    }
    _cachedColW = colW;
  }
  const result = positioner.update(props.items, {
    columns: cols, width: colW, gap: props.gap, left: contentLeftOffset.value,
  }, props.keyMapper, resolveHeight, dirtyFrom);
  dirtyFrom = Infinity;

  if (mappedHeightCache.size > props.items.length || measuredHeights.size > props.items.length) {
    for (const key of mappedHeightCache.keys()) {
      if (!positioner.byKey.has(key)) mappedHeightCache.delete(key);
    }
    for (const key of measuredHeights.keys()) {
      if (!positioner.byKey.has(key)) measuredHeights.delete(key);
    }
  }
  return result;
});

function findFirstColumnItem(
  items: MasonryItem[],
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
// buffer 按列数反向缩放：列数越多，单位 buffer 高度内承载的卡片数越多，
// 用 (BUFFER_REFERENCE_COLUMNS / cols) 缩放后，渲染中的卡片总数大致与列数无关，
// 避免 6 列时同屏 DOM 比 5 列多 20% 导致的滚动卡顿。
//
// 注：MAX 设为 1.0 而非更大值——cols < 5 时手机 / 窄屏 viewport 也小，单屏卡片
// 本来就不多，再放大 buffer 等于让 cols=2 一次性渲染 30~40 张卡（+ 频繁 RO 测量），
// 反而劣化首屏帧率。1.0 即"不放大、只缩小"。
const BUFFER_REFERENCE_COLUMNS = 5;
const BUFFER_SCALE_MIN = 0.5;
const BUFFER_SCALE_MAX = 1.0;

// 渲染只用到 key / index / left / top / width；这些都没变就视为同一个可见集
function sameVisibleItems(a: MasonryItem[], b: MasonryItem[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.key !== y.key || x.index !== y.index ||
      x.left !== y.left || x.top !== y.top || x.width !== y.width
    ) return false;
  }
  return true;
}

// scrollY 每帧都在变，但多数帧并没有卡片进出视口。可见集不变时返回上一次的
// 数组（computed 的 oldValue），Vue 不会通知依赖方，本组件这一帧就不重渲染。
let renderedWindow: { top: number; bottom: number; layout: ReturnType<typeof positioner.update> } | undefined;
const visibleItems = computed((prev?: MasonryItem[]) => {
  const sy = scrollY.value;
  const vh = viewportH.value;
  const cols = columnCount.value;
  const bufScale = Math.min(
    BUFFER_SCALE_MAX,
    Math.max(BUFFER_SCALE_MIN, BUFFER_REFERENCE_COLUMNS / Math.max(1, cols)),
  );
  const buf = Math.max(0, props.buffer) * bufScale;
  const currentLayout = layout.value;
  const containerOffset = containerOffsetY.value;
  const viewportTop = sy - containerOffset;
  const viewportBottom = viewportTop + vh;
  // Refill the overscan window in batches. Small scrolls no longer mount/unmount
  // a row at every card boundary, while a guard remains ahead of the viewport.
  const guard = Math.min(120, buf * 0.25);
  if (prev && renderedWindow?.layout === currentLayout
    && viewportTop - guard >= renderedWindow.top
    && viewportBottom + guard <= renderedWindow.bottom) return prev;
  const dir = scrollDirection.value;

  // 根据滚动方向使用温和的非对称缓冲区：滚动方向 1.4x，反方向 1.0x
  // 注：差值过大会在 scrollDirection 翻转瞬间一次性增删大量 DOM 引起跳动，
  // 配合 onScroll 中的方向翻转阈值（DIRECTION_FLIP_THRESHOLD），可显著减少抖动。
  const bufAbove = dir >= 0 ? buf * 1.0 : buf * 1.4;
  const bufBelow = dir >= 0 ? buf * 1.4 : buf * 1.0;
  const top = viewportTop - bufAbove;
  const bottom = viewportBottom + bufBelow;
  renderedWindow = { top, bottom, layout: currentLayout };

  const visible: MasonryItem[] = [];
  const columns = currentLayout.columns;

  for (const columnItems of columns) {
    const startIndex = findFirstColumnItem(columnItems, top, 0);

    for (let i = startIndex; i < columnItems.length; i++) {
      const item = columnItems[i];
      if (!item) continue;

      const itemTop = item.top;
      if (itemTop > bottom) break;

      visible.push(item);
    }
  }

  return prev && sameVisibleItems(prev, visible) ? prev : visible;
});

/* ── 容器与 item 的样式 ────────────────────────── */
const containerStyle = computed((previous?: { height: string }) => {
  const height = `${layout.value.totalHeight}px`;
  return previous?.height === height ? previous : { height };
});

/* ── 获取原始 item 对象 ────────────────────────── */
function getItem(layoutItem: MasonryItem): T {
  return props.items[layoutItem.index] as T;
}

/* ── 滚动监听 ──────────────────────────────────── */
function updateContainerOffset() {
  if (containerRef.value) {
    containerOffsetY.value = window.scrollY + containerRef.value.getBoundingClientRect().top;
  }
}

// Call after content above the list changes its document position. Keeping this
// explicit avoids a layout read for every scroll or appended page.
function refreshOffset() {
  updateContainerOffset();
  // Browser scroll anchoring can move scrollY together with the content above.
  scrollY.value = window.scrollY;
}

function onWindowResize() {
  if (resizeRAF !== null) return;
  resizeRAF = requestAnimationFrame(() => {
    resizeRAF = null;
    updateContainerOffset();
    viewportH.value = window.innerHeight;
  });
}

function onScroll() {
  // rAF 节流：若当前帧已排队，直接跳过本次事件，避免 cancel/request 抖动
  if (scrollRAF !== null) return;
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = null;
    const currentY = window.scrollY;
    const delta = currentY - _prevScrollY;
    if (delta !== 0) {
      // 累计同方向位移，反方向时立即重置；超过阈值才翻转 scrollDirection。
      // 这样可避免惯性滚动末段或微小抖动导致 buffer 反复切换造成可见区抖动。
      if ((delta > 0) === (_directionAccum >= 0)) {
        _directionAccum += delta;
      } else {
        _directionAccum = delta;
      }
      const desiredDir = _directionAccum > 0 ? 1 : -1;
      if (
        scrollDirection.value !== desiredDir &&
        Math.abs(_directionAccum) >= DIRECTION_FLIP_THRESHOLD
      ) {
        scrollDirection.value = desiredDir;
      }
      _prevScrollY = currentY;
    }
    if (scrollY.value !== currentY) scrollY.value = currentY;
    const vh = window.innerHeight;
    if (viewportH.value !== vh) viewportH.value = vh;
  });
}

/* ── ResizeObserver: 测量 item 真实高度 ────────── */
// 测量误差容忍：小于该阈值的高度变化不触发 layout 重排，避免子像素差异造成滚动抖动
const MEASURE_DIFF_THRESHOLD = 1;

function setupResizeObserver() {
  if (!props.measureItems) return;

  resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const key = observedElements.get(entry.target);
      if (key === undefined) continue;
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const rounded = Math.round(h);
      if (rounded <= 0) continue;
      measuredHeights.set(key, rounded);
      // 与布局实际使用的高度比较，而不是与"是否测量过"比较：observe 后首次回调
      // 必定到来，若首测一律算作变化，每张新挂载的卡片都会触发一次全量重排。
      const positioned = positioner.byKey.get(key);
      const used = positioned?.height;
      if (used === undefined || Math.abs(used - rounded) >= MEASURE_DIFF_THRESHOLD) {
        dirtyFrom = Math.min(dirtyFrom, positioned?.index ?? 0);
        changed = true;
      }
    }
    // ResizeObserver already batches measurements before paint; Vue batches the
    // resulting render. A second rAF would leave corrected positions a frame late.
    if (changed) heightVersion.value++;
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
  containerResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const width = entry.contentRect.width;
    // Appending a page changes height but not width. Do not schedule another
    // frame or read layout for those notifications.
    if (width > 0 && width !== containerWidth.value) {
      containerWidth.value = width;
      updateContainerOffset();
    }
  });
  containerResizeObserver.observe(containerRef.value);
}

/* ── item-ref 回调 (供模板使用) ─────────────────── */
const itemRefMap = new Map<string | number, Element>();

function setItemRef(el: Element | null, key: string | number) {
  if (!props.measureItems) return;

  const existing = itemRefMap.get(key);
  if (existing === el) return;
  if (existing && existing !== el) {
    unobserveItem(existing);
    itemRefMap.delete(key);
  }
  if (el) {
    itemRefMap.set(key, el);
    observeItem(el, key);
  }
}

// Mapper/measurement options can change independently of the item array.
watch([() => props.heightMapper, () => props.keyMapper, () => props.estimatedHeight, () => props.measureItems], () => {
  mappedHeightCache.clear();
  dirtyFrom = 0;
  heightVersion.value++;
});

/* ── 生命周期 ──────────────────────────────────── */
onMounted(() => {
  scrollY.value = window.scrollY;
  _prevScrollY = window.scrollY;
  viewportH.value = window.innerHeight;
  // 容器无 border / padding；一次读取同时取得宽度和文档偏移。
  // 保留与 ResizeObserver 相同的小数精度，避免 clientWidth 取整后误清恢复的高度。
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    containerWidth.value = rect.width;
    containerOffsetY.value = window.scrollY + rect.top;
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onWindowResize, { passive: true });
  setupResizeObserver();
  setupContainerResize();
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onWindowResize);
  if (scrollRAF !== null) cancelAnimationFrame(scrollRAF);
  if (resizeRAF !== null) cancelAnimationFrame(resizeRAF);
  resizeObserver?.disconnect();
  containerResizeObserver?.disconnect();
  observedElements.clear();
  itemRefMap.clear();
  mappedHeightCache.clear();
});

/* ── Expose ───────────────────────────────────── */
defineExpose({ measuredHeights, measuredWidth: actualColumnWidth, refreshOffset });
</script>

<template>
  <div ref="containerRef" class="ik-vm" :style="containerStyle">
    <div
      v-for="layoutItem in visibleItems"
      :key="layoutItem.key"
      class="ik-vm-item"
      :ref="(el) => setItemRef(el as Element | null, layoutItem.key)"
      :style="layoutItem.style"
    >
      <slot
        :item="getItem(layoutItem)"
        :index="layoutItem.index"
        :width="layoutItem.width"
        :column-count="columnCount"
      />
    </div>
  </div>
</template>

<style scoped>
.ik-vm {
  position: relative;
  width: 100%;
}

/* Styles are created once per position, rather than once per render. */
.ik-vm-item {
  position: absolute;
  top: 0;
  left: 0;
  contain: layout style paint;
}
</style>
