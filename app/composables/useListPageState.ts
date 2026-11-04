import { listPagePosition, readListPageState, saveListPageState } from "~/utils/list-page-state";

/** 分页背景页重新挂载时同步恢复数据和瀑布流高度，滚动由路由统一恢复。 */
export function useListPageState<T>(capture: () => T | null) {
  const route = useRoute();
  const auth = useAuthStore();
  const position = import.meta.client ? listPagePosition(route.fullPath, window.history.state ?? {}) : 0;
  const snapshot = import.meta.client ? readListPageState<T>(route.fullPath, position, auth.generation) : undefined;
  const masonryRef = shallowRef<{ measuredHeights: Map<string | number, number>; measuredWidth: number } | null>(null);
  const initialHeights = shallowRef(snapshot?.heights);
  const initialMeasuredWidth = shallowRef(snapshot?.measuredWidth);

  onBeforeRouteLeave(() => {
    const data = capture();
    if (data === null) return;
    saveListPageState(route.fullPath, position, auth.generation, {
      data,
      heights: new Map(masonryRef.value?.measuredHeights),
      measuredWidth: masonryRef.value?.measuredWidth,
      scrollY: window.scrollY,
    });
  });
  return { restored: snapshot?.data, masonryRef, initialHeights, initialMeasuredWidth };
}
