/**
 * useHomeStateCache — 首页瀑布流状态的模块级缓存
 *
 * 组件卸载前快照所有关键状态（列表、分页游标、已测量高度、scrollY），
 * 重建时恢复，配合 VirtualMasonry 的 initialHeights prop 实现像素级精确的滚动还原。
 *
 * 依赖关系：measuredHeights 确保重建后布局完全一致 → scrollY 可直接定位。
 */
import type { Post } from "~/types/entities";

export interface HomeStateSnapshot {
  list: Post[];
  endCursor: string;
  hasNextPage: boolean;
  query: string;
  seenIds: Set<string>;
  measuredHeights: Map<string | number, number>;
  /** 路由离开瞬间的 window.scrollY（DOM 完好时采集，值精确） */
  scrollY: number;
}

// ── 模块级单例：在 HMR / 路由导航间持久存在 ──────────
let _snapshot: HomeStateSnapshot | null = null;
// scrollY 独立存储：setup 阶段 clear() 清空 snapshot 后，
// scrollBehavior 仍需在后续 nextTick 中读取此值。
let _pendingScrollY = 0;

export function useHomeStateCache() {
  function save(state: HomeStateSnapshot) {
    _snapshot = state;
    _pendingScrollY = state.scrollY;
  }

  function restore(): HomeStateSnapshot | null {
    return _snapshot;
  }

  /** 读取并消费 scrollY（供 router scrollBehavior 使用，与 snapshot 生命周期解耦） */
  function consumeScrollY(): number {
    const y = _pendingScrollY;
    _pendingScrollY = 0;
    return y;
  }

  function clear() {
    _snapshot = null;
  }

  return { save, restore, consumeScrollY, clear };
}
