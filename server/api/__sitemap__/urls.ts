/**
 * 动态 sitemap 数据源：分页拉取后端已发布帖子，生成 /post/<documentId> 条目。
 *
 * 由 @nuxtjs/sitemap 的 `sitemap.sources` 在生成 sitemap.xml 时调用。
 * 后端 /api/articles/list 返回 { data: [{ documentId, ... }], meta: { pagination: { total } } }。
 */

const PAGE_LIMIT = 100;
// 安全上限，避免后端数据异常时无限翻页。
const MAX_PAGES = 100;

interface ArticleListItem {
  documentId?: string;
  id?: string | number;
}

interface ArticleListResponse {
  data?: ArticleListItem[];
  meta?: { pagination?: { total?: number } };
}

export default defineSitemapEventHandler(async () => {
  const config = useRuntimeConfig();
  const apiBaseUrl = config.public.apiBaseUrl;
  if (!apiBaseUrl) return [];

  const urls: { loc: string; changefreq: "daily"; priority: 0.8 }[] = [];
  const seen = new Set<string>();

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * PAGE_LIMIT;
      const res = await $fetch<ArticleListResponse>("/api/articles/list", {
        baseURL: apiBaseUrl,
        query: { start: String(start), limit: String(PAGE_LIMIT) },
      });

      const items = Array.isArray(res?.data) ? res.data : [];
      if (!items.length) break;

      for (const item of items) {
        const docId = String(item.documentId || item.id || "");
        if (!docId || seen.has(docId)) continue;
        seen.add(docId);
        urls.push({ loc: `/post/${docId}`, changefreq: "daily", priority: 0.8 });
      }

      const total = res?.meta?.pagination?.total;
      if (typeof total === "number" && start + items.length >= total) break;
      if (items.length < PAGE_LIMIT) break;
    }
  } catch {
    // 后端不可达时返回已收集到的部分，sitemap 仍包含静态路由。
  }

  return urls;
});
