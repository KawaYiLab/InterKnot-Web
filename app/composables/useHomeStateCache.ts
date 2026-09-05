/**
 * useHomeStateCache — 首页瀑布流状态的模块级缓存
 *
 * 组件卸载前快照所有关键状态（列表、分页游标、已测量高度、scrollY），
 * 重建时恢复，配合 VirtualMasonry 的 initialHeights prop 实现像素级精确的滚动还原。
 *
 * 依赖关系：measuredHeights 确保重建后布局完全一致 → scrollY 可直接定位。
 */
import type { ArticleFeed, ArticleSort, Post } from "~/types/entities";

export interface HomeStateSnapshot {
  list: Post[];
  /**
   * 信息流分页游标，原样存原样回传（形状不变，仍是字符串）。
   * 新格式是 `"<已加载条数>~<后端给的不透明 token>"`（见 utils/pagination 的 composeCursor：
   * 条数是为了后端回滚成 offset 版本时能接着翻），空串 = 第一页；快照里也可能留着切游标
   * 之前的 "0" 或裸 token，useApi 的 resolveCursor 三种都认，旧快照恢复后不会翻页错位。
   */
  endCursor: string;
  hasNextPage: boolean;
  query: string;
  category: string;
  feed: ArticleFeed;
  sort: ArticleSort;
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
