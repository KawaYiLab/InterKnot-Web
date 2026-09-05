import type { Pagination } from "~/types/api";

export const DEFAULT_PAGE_SIZE = 20;

export function parseStart(endCursor: string): number {
  return Number.parseInt(endCursor || "0", 10) || 0;
}

export interface BackendPaginationMeta {
  start?: number;
  limit?: number;
  total?: number;
  pageCount?: number;
}

export function buildPagination<T>(
  nodes: T[],
  start: number,
  meta?: BackendPaginationMeta,
): Pagination<T> {
  const limit = meta?.limit ?? DEFAULT_PAGE_SIZE;
  const nextStart = start + limit;

  // Use backend total when available for accurate hasNextPage
  const hasNextPage =
    typeof meta?.total === "number"
      ? nextStart < meta.total
      : nodes.length >= DEFAULT_PAGE_SIZE;

  return {
    nodes,
    endCursor: String(nextStart),
    hasNextPage,
  };
}

// ── 游标分页 ──────────────────────────────────────────────
// 信息流（/api/articles/list）与评论回复（/api/comments/:id/replies）改走不透明游标。
// Pagination<T> 的形状不用动：endCursor 一直是「原样存下来、下次原样回传」的字符串，
// 组件从不对它做算术，换成 base64url token 对上层完全透明。

/**
 * 后端游标分页的响应元信息。两个接口的挂点不同，extractCursorMeta 两种都认：
 * - 信息流挂在 meta.pagination 下（与 start/total 同层，兼容期两套字段并存）
 * - 评论回复挂在 meta 下
 */
export interface CursorPaginationMeta {
  /** 后端明确表态还有没有下一页；缺省（undefined）时以 nextCursor 是否存在为准 */
  hasMore?: boolean;
  /** 不透明续传 token；null 表示到底了 */
  nextCursor: string | null;
}

export interface ResolvedCursor {
  /** 不透明游标；空串表示第一页，此时不该带 cursor 参数 */
  cursor: string;
  /** offset 模式的起点；也是游标模式下「已加载到第几条」的备用位置，见 composeCursor */
  start: number;
}

const OFFSET_CURSOR_RE = /^\d+$/;

/**
 * 游标串里同时带上「已加载条数」的分隔符：存下来的形态是 `"<已加载条数>~<不透明 token>"`。
 * base64url 的字符集是 A-Za-z0-9-_（Node 的 base64url 连 = 都不留），不含 `~`，
 * 所以拿它切分不会切坏 token。
 *
 * 为什么非带不可：前后端独立发布，**游标翻到一半时后端可能被灰度/回滚成没有游标的版本**
 * （滚动发布期间同一个用户的两页请求可以落在新旧两个实例上）。那一刻手上只有一个老后端
 * 不认的 token，如果不知道自己已经翻到第几条，就只能从 start=0 重来：那 20 条全在
 * seenIds 里被去重掉，列表一条不长，hasNextPage 又按 total 算成 true，表现就是
 * 「信息流彻底不动了」，得一页页磨回原位。带上条数就能就地续上 offset 分页。
 * 位置只能记在游标串里，不能记在会话状态里：首页把 endCursor 存进 localStorage 快照，
 * 刷新后要靠它恢复翻页位置，模块级状态活不过一次刷新。
 */
const CURSOR_OFFSET_SEP = "~";

/** 把「已加载条数 + 不透明 token」拼成存下来的游标串；没有 token 就是到底了（第一页哨兵）。 */
export function composeCursor(loaded: number, token: string | null | undefined): string {
  if (!token) return "";
  const safeLoaded = Number.isFinite(loaded) ? Math.max(0, Math.trunc(loaded)) : 0;
  return `${safeLoaded}${CURSOR_OFFSET_SEP}${token}`;
}

/**
 * 把一个 endCursor 字符串翻译成本次请求该带的参数。兼容期内它有四种可能：
 * - ""（新代码的第一页）或 "0"（切游标前的旧哨兵，首页状态快照里可能还留着）→ 第一页
 * - 纯数字串 → 后端还没上游标，是 buildPagination 攒出来的 offset，继续按 start 翻。
 *   这一步不能省：把 "20" 原样当 cursor 发出去，老后端会忽略它并按 start 缺省重发第一页，
 *   翻页就此原地打转（列表去重后看起来像"加载更多没反应"）。
 * - `"<数字>~<token>"` → 游标模式，token 当 cursor 发，数字是「已加载条数」，
 *   同时当 start 发出去兜住后端回滚（见 CURSOR_OFFSET_SEP）
 * - 其余 → 裸 token（带条数之前的快照里可能存着），当游标发，位置只能按 0 算
 */
export function resolveCursor(endCursor: string | null | undefined): ResolvedCursor {
  if (!endCursor || endCursor === "0") return { cursor: "", start: 0 };
  if (OFFSET_CURSOR_RE.test(endCursor)) return { cursor: "", start: parseStart(endCursor) };
  const sep = endCursor.indexOf(CURSOR_OFFSET_SEP);
  if (sep > 0) {
    const loaded = endCursor.slice(0, sep);
    const token = endCursor.slice(sep + 1);
    if (token && OFFSET_CURSOR_RE.test(loaded)) {
      return { cursor: token, start: parseStart(loaded) };
    }
  }
  return { cursor: endCursor, start: 0 };
}

function toRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
}

function readCursorFields(source?: Record<string, unknown>): CursorPaginationMeta | undefined {
  if (!source) return undefined;
  // 以 nextCursor 这个键在不在为准（不是值有没有）：
  // - 最后一页的 nextCursor 就是 null，按值判会被误认成「后端还没部署游标」而退回 offset，
  //   于是拿 total 算出 hasNextPage=true，再把一个数字当游标发出去；
  // - 只认 nextCursor 不认 hasMore：万一别的接口（如搜索）也叫 hasMore 但压根没有游标，
  //   误切游标模式会让它永远停在第一页。契约里这两个字段是一起给的，认严的那个。
  if (!("nextCursor" in source)) return undefined;
  return {
    hasMore: typeof source.hasMore === "boolean" ? source.hasMore : undefined,
    nextCursor:
      typeof source.nextCursor === "string" && source.nextCursor ? source.nextCursor : null,
  };
}

/**
 * 从响应里读游标元信息。返回 undefined 表示这个后端还没上游标分页，调用方必须退回 offset ——
 * 前后端独立发布，前端会先上线，这个回退是硬要求。
 */
export function extractCursorMeta(payload: unknown): CursorPaginationMeta | undefined {
  const meta = toRecord(toRecord(payload)?.meta);
  if (!meta) return undefined;
  return readCursorFields(toRecord(meta.pagination)) ?? readCursorFields(meta);
}

/**
 * 用游标元信息拼 Pagination：endCursor 就是 nextCursor，调用方只负责原样回传。
 *
 * `loadedBefore` 只有信息流会传：它需要在后端回滚成 offset 版本时接着翻，所以游标串里
 * 要带上「已加载条数」（见 composeCursor）。评论回复那条路由是随游标分页一起新增的，
 * 没有 offset 回退路径，传了反而会把 `"20~token"` 这种串当 cursor 发出去。
 */
export function buildCursorPagination<T>(
  nodes: T[],
  meta: CursorPaginationMeta,
  loadedBefore?: number,
): Pagination<T> {
  const nextCursor = meta.nextCursor ?? "";
  return {
    nodes,
    endCursor:
      nextCursor && loadedBefore !== undefined
        ? composeCursor(loadedBefore + nodes.length, nextCursor)
        : nextCursor,
    // 没有 nextCursor 就无从续传（哪怕后端说 hasMore）；后端明确说没有下一页时也停。
    hasNextPage: !!nextCursor && meta.hasMore !== false,
  };
}
