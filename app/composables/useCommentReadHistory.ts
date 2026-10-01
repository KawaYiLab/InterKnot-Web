import { ref, readonly } from "vue";
import type { Ref } from "vue";
import type { Comment } from "~/types/entities";

export interface CommentReadRecord {
  postId: string;
  commentId: string;
  floor?: number;
  authorName?: string;
  updatedAt: number;
}

export interface VisibleCommentResult {
  isTop: boolean;
  commentId: string;
  floor?: number;
  authorName?: string;
}

const POSITIONS_KEY = "ik:comment-read-positions";
const AUTO_RESTORE_KEY = "ik:comment-auto-restore";
const MAX_RECORDS = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天过期

// 模块级单例缓存
let inMemoryRecords: CommentReadRecord[] | null = null;
const autoRestoreRef = ref(false);
let initialized = false;

function readStorage(): CommentReadRecord[] {
  if (!import.meta.client && typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    // 过滤损坏数据及超过 30 天未访问的陈旧记录
    const valid = parsed.filter(
      (item): item is CommentReadRecord => {
        if (typeof item !== "object" || item === null) return false;
        const record = item as Record<string, unknown>;
        return (
          typeof record.postId === "string" &&
          typeof record.commentId === "string" &&
          typeof record.updatedAt === "number" &&
          now - record.updatedAt <= MAX_AGE_MS
        );
      },
    );

    // 如果有被清除的过期记录，自动回写清理
    if (valid.length !== parsed.length) {
      writeStorage(valid);
    }

    return valid.slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function writeStorage(records: CommentReadRecord[]) {
  if (!import.meta.client && typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(records));
  } catch {
    // 忽略写入失败（例如隐私模式配额超限）
  }
}

function readAutoRestore(): boolean {
  if (!import.meta.client && typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(AUTO_RESTORE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeAutoRestore(enabled: boolean) {
  if (!import.meta.client && typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AUTO_RESTORE_KEY, String(enabled));
  } catch {
    // 忽略写入失败
  }
}

function ensureInitialized() {
  if (initialized) return;
  if (!import.meta.client && typeof window === "undefined") return;
  initialized = true;
  inMemoryRecords = readStorage();
  autoRestoreRef.value = readAutoRestore();

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === POSITIONS_KEY) {
        inMemoryRecords = readStorage();
      } else if (e.key === AUTO_RESTORE_KEY) {
        autoRestoreRef.value = readAutoRestore();
      }
    });
  }
}

/** 仅供单元测试重置内部状态 */
export function _resetStorageForTest() {
  inMemoryRecords = null;
  initialized = false;
  autoRestoreRef.value = false;
}

/**
 * 评论区视口探测算法：
 * 探测给定滚动容器中，当前视口最上方的评论节点及对应楼层。
 * 当容器滚动距离顶部小于 60px 时，标记为 isTop: true。
 */
export function findTopVisibleComment(
  container: HTMLElement,
  comments: Comment[],
): VisibleCommentResult | null {
  if (!container || !comments || !comments.length) return null;

  // 1. 当滚动距离小于 60px 时，判定为用户处于或已回到评论区最顶端
  if (container.scrollTop < 60) {
    const first = comments[0];
    return {
      isTop: true,
      commentId: first?.id || "",
      floor: first?.floor ?? 1,
      authorName: first?.author?.name,
    };
  }

  // 2. 遍历容器内的评论节点，寻找正处于视口顶部的评论
  const containerRect = container.getBoundingClientRect();
  const elements = container.querySelectorAll<HTMLElement>(".ik-comment[data-comment-id]");
  if (!elements.length) return null;

  let bestEl: HTMLElement | null = null;
  let minDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    // 元素完全在视口上方之上，跳过
    if (rect.bottom < containerRect.top) continue;

    // 元素的 top 相对容器顶部的偏移
    const offset = Math.abs(rect.top - containerRect.top);
    if (offset < minDiff) {
      minDiff = offset;
      bestEl = el;
      if (rect.top >= containerRect.top && rect.top <= containerRect.top + 60) {
        break;
      }
    }
  }

  if (!bestEl) return null;

  const commentId = bestEl.getAttribute("data-comment-id");
  if (!commentId) return null;

  // 匹配评论元数据
  for (const c of comments) {
    if (c.id === commentId) {
      return {
        isTop: false,
        commentId,
        floor: c.floor,
        authorName: c.author?.name,
      };
    }
    const reply = c.replies?.find((r) => r.id === commentId);
    if (reply) {
      return {
        isTop: false,
        commentId,
        floor: c.floor,
        authorName: reply.author?.name || c.author?.name,
      };
    }
  }

  return {
    isTop: false,
    commentId,
  };
}

/**
 * 评论阅读历史记录 Composable：
 * 提供单篇帖子的阅读断点读取、更新、清除与 LRU 淘汰机制。
 */
export function useCommentReadHistory() {
  ensureInitialized();

  function getRecord(postId: string): CommentReadRecord | null {
    if (!postId) return null;
    const records = inMemoryRecords ?? readStorage();
    inMemoryRecords = records;
    const found = records.find((r) => r.postId === postId);
    if (!found) return null;

    // 校验是否超过 30 天
    if (Date.now() - found.updatedAt > MAX_AGE_MS) {
      clearRecord(postId);
      return null;
    }
    return found;
  }

  function saveRecord(
    postId: string,
    data: { commentId: string; floor?: number; authorName?: string },
  ) {
    if (!postId || !data.commentId) return;
    const current = inMemoryRecords ?? readStorage();
    const existingIndex = current.findIndex((r) => r.postId === postId);

    const record: CommentReadRecord = {
      postId,
      commentId: data.commentId,
      floor: data.floor,
      authorName: data.authorName,
      updatedAt: Date.now(),
    };

    let next: CommentReadRecord[];
    if (existingIndex >= 0) {
      // 移到最前（LRU）
      next = [record, ...current.filter((r) => r.postId !== postId)];
    } else {
      next = [record, ...current];
    }

    if (next.length > MAX_RECORDS) {
      next = next.slice(0, MAX_RECORDS);
    }

    inMemoryRecords = next;
    writeStorage(next);
  }

  function clearRecord(postId: string) {
    if (!postId) return;
    const current = inMemoryRecords ?? readStorage();
    const next = current.filter((r) => r.postId !== postId);
    if (next.length === current.length) return;
    inMemoryRecords = next;
    writeStorage(next);
  }

  function setAutoRestore(enabled: boolean) {
    autoRestoreRef.value = enabled;
    writeAutoRestore(enabled);
  }

  return {
    getRecord,
    saveRecord,
    clearRecord,
    autoRestore: readonly(autoRestoreRef) as Ref<boolean>,
    setAutoRestore,
  };
}
