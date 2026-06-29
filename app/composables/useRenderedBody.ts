import { computed, ref, toValue, watch, type MaybeRefOrGetter } from "vue";

// 帖子正文渲染依赖 markdown-it + DOMPurify（合计较大）。这两个库只在真正展示
// 帖子正文时才需要，而非首页 feed / 登录等首屏路径。这里通过动态 import 把
// utils/format-body 整块（含 markdown-it / dompurify）切成按需加载的异步 chunk，
// 不进首屏 entry chunk。详见 utils/format-body.ts。

type BodyFormatter = typeof import("~/utils/format-body");

let formatterPromise: Promise<BodyFormatter> | null = null;
function loadBodyFormatter(): Promise<BodyFormatter> {
  if (!formatterPromise) {
    // chunk 拉取失败（弱网/代理）时不要把 rejected promise 永久缓存，
    // 否则后续渲染永远拿到失败结果、无法恢复。失败即清空，留待下次重试。
    formatterPromise = import("~/utils/format-body").catch((err) => {
      formatterPromise = null;
      throw err;
    });
  }
  return formatterPromise;
}

interface BodySource {
  body?: string | null;
  bodyText?: string | null;
}

/**
 * 把帖子的 body / bodyText 异步渲染为安全 HTML。
 * - `bodyHtml`：渲染后的 HTML（格式化库加载完成前为空字符串）。
 * - `hasContent`：是否有正文内容（用于区分「加载中/有正文」与「确实没有正文」，
 *   避免在 chunk 加载期间误闪「啥都木有」占位）。
 */
export function useRenderedBody(
  source: MaybeRefOrGetter<BodySource | null | undefined>,
) {
  const bodyHtml = ref("");
  const hasContent = computed(() => {
    const post = toValue(source);
    return !!(post && (post.body || post.bodyText));
  });

  let token = 0;
  watch(
    () => {
      const post = toValue(source);
      return post ? `${post.body ?? ""}\u0000${post.bodyText ?? ""}` : "";
    },
    async () => {
      const post = toValue(source);
      const current = ++token;
      if (!post || (!post.body && !post.bodyText)) {
        bodyHtml.value = "";
        return;
      }
      try {
        const fmt = await loadBodyFormatter();
        // 渲染期间 source 可能已切换，丢弃过期结果。
        if (current !== token) return;
        bodyHtml.value = post.body
          ? fmt.sanitizeBodyHtml(post.body)
          : fmt.formatBodyText(post.bodyText ?? "");
      } catch {
        // 格式化库加载失败（弱网/代理）：保持空正文，不抛未捕获异常。
        // loadBodyFormatter 已清空缓存，source 变化时会自动重试。
        if (current === token) bodyHtml.value = "";
      }
    },
    { immediate: true },
  );

  return { bodyHtml, hasContent };
}
