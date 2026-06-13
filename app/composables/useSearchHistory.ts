/**
 * useSearchHistory —— 本地搜索历史记录
 *
 * 把用户的搜索关键词持久化到 localStorage（仅本地保存，不上报服务端），
 * 在搜索框聚焦且无输入时展示，便于一键复用历史搜索。
 *
 * - 最近搜索在前，去重（忽略大小写与首尾空白）
 * - 最多保留 MAX_HISTORY 条，单条关键词截断到 MAX_KEYWORD_LENGTH
 * - 模块级单例 + storage 事件：多个组件实例 / 多标签页共享同一份状态
 * - SSR 阶段返回空列表（localStorage 不可用），客户端挂载后再回填，避免水合不一致
 */

const STORAGE_KEY = "ik:search-history";
const MAX_HISTORY = 12;
const MAX_KEYWORD_LENGTH = 64;

// 模块级单例：跨组件实例共享同一份响应式状态
const history = ref<string[]>([]);
let initialized = false;

function readStorage(): string[] {
  if (!import.meta.client) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function writeStorage(list: string[]) {
  if (!import.meta.client) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 忽略写入失败（隐私模式 / 配额超限），历史仅为锦上添花的功能
  }
}

function ensureInitialized() {
  if (initialized || !import.meta.client) return;
  initialized = true;
  history.value = readStorage();
  // 跨标签页同步：其他标签更新历史时刷新本地状态
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) history.value = readStorage();
  });
}

export function useSearchHistory() {
  ensureInitialized();

  /** 记录一次搜索：置顶并去重，超出上限则丢弃最旧的 */
  function add(keyword: string) {
    const value = keyword.trim().slice(0, MAX_KEYWORD_LENGTH);
    if (!value) return;
    const lower = value.toLowerCase();
    const next = [value, ...history.value.filter((k) => k.toLowerCase() !== lower)].slice(
      0,
      MAX_HISTORY,
    );
    history.value = next;
    writeStorage(next);
  }

  /** 删除单条历史记录 */
  function remove(keyword: string) {
    const next = history.value.filter((k) => k !== keyword);
    if (next.length === history.value.length) return;
    history.value = next;
    writeStorage(next);
  }

  /** 清空全部历史记录 */
  function clear() {
    if (history.value.length === 0) return;
    history.value = [];
    writeStorage([]);
  }

  return {
    history: readonly(history),
    add,
    remove,
    clear,
  };
}
