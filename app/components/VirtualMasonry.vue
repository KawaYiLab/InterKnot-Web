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
    maxColumnWidth?: number;
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
let measureRAF: number | null = null;
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

  const leftOffset = contentLeftOffset.value;

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
    const left = leftOffset + minCol * (colW + gap);

    const layoutItem = { key, index: i, top, left, width: colW, height: h };
    result.push(layoutItem);
    columns[minCol]?.push(layoutItem);
    colHeights[minCol] = top + h + gap;
  }

  // colHeights 每列累加值末尾都带了一个 gap（colHeights[col] = top + h + gap），
  // 直接 max 会让容器底部多出一个 gap 像素的空白。减去 gap 得到真实内容总高。
  let maxCol = 0;
  for (let c = 0; c < colHeights.length; c++) {
    const v = colHeights[c] ?? 0;
    if (v > maxCol) maxCol = v;
  }
  const totalHeight = maxCol > 0 ? maxCol - gap : 0;
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

const visibleItems = computed(() => {
  const sy = scrollY.value;
  const vh = viewportH.value;
  const cols = columnCount.value;
  const bufScale = Math.min(
    BUFFER_SCALE_MAX,
    Math.max(BUFFER_SCALE_MIN, BUFFER_REFERENCE_COLUMNS / Math.max(1, cols)),
  );
  const buf = props.buffer * bufScale;
  const dir = scrollDirection.value;

  // 根据滚动方向使用温和的非对称缓冲区：滚动方向 1.4x，反方向 1.0x
  // 注：差值过大会在 scrollDirection 翻转瞬间一次性增删大量 DOM 引起跳动，
  // 配合 onScroll 中的方向翻转阈值（DIRECTION_FLIP_THRESHOLD），可显著减少抖动。
  const bufAbove = dir >= 0 ? buf * 1.0 : buf * 1.4;
  const bufBelow = dir >= 0 ? buf * 1.4 : buf * 1.0;
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

/* ── 容器与 item 的样式 ────────────────────────── */
const containerStyle = computed<StyleValue>(() => ({
  position: "relative" as const,
  width: "100%",
  height: `${layout.value.totalHeight}px`,
}));

// 只输出动态字段（width + transform）；静态 position/top/left/contain 由
// .ik-vm-item class 承担。减少每帧 50+ 个对象字面量的 GC 压力，
// 也避免每个 item 都把 contain 等冗余属性走 Vue patch。
function itemStyle(it: LayoutItem): StyleValue {
  return {
    width: `${it.width}px`,
    transform: `translate(${it.left}px, ${it.top}px)`,
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
      const prev = measuredHeights.get(key);
      if (prev === undefined || Math.abs(prev - rounded) >= MEASURE_DIFF_THRESHOLD) {
        measuredHeights.set(key, rounded);
        changed = true;
      }
    }
    if (changed) {
      // 合并到下一帧批量提交：避免一次 ResizeObserver 回调内多次 layout 重算，
      // 也避免与滚动 rAF 在同一帧内争用导致抖动。
      if (measureRAF === null) {
        measureRAF = requestAnimationFrame(() => {
          measureRAF = null;
          heightVersion.value++;
        });
      }
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
  // 同步读一次 clientWidth：container 已 attached（外层 <ClientOnly> 保证客户端
  // 才渲染本组件），避免首帧 containerWidth=0 → cols 退回 minColumns → 用户可见
  // 一次"假布局 → 真布局"的重排闪烁。
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth;
    updateContainerOffset();
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  setupResizeObserver();
  await nextTick();
  setupContainerResize();
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  if (scrollRAF !== null) cancelAnimationFrame(scrollRAF);
  if (resizeRAF !== null) cancelAnimationFrame(resizeRAF);
  if (measureRAF !== null) cancelAnimationFrame(measureRAF);
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
  <div ref="containerRef" :style="containerStyle">
    <div
      v-for="layoutItem in visibleItems"
      :key="layoutItem.key"
      class="ik-vm-item"
      :ref="(el: any) => setItemRef(el as Element, layoutItem.key)"
      :style="itemStyle(layoutItem)"
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
/* 所有 item 共用静态定位，只让动态部分（width / transform）走 inline style，
   减少每帧大量字面量对象创建与 Vue patch 比较成本。 */
.ik-vm-item {
  position: absolute;
  top: 0;
  left: 0;
  contain: layout style paint;
}
</style>
