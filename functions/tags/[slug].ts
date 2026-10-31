import {
  type Env,
  type LoadResult,
  escapeHtml,
  fetchApi,
  renderShell,
  siteOrigin,
  truncate,
} from "../../edge/seo";

/** GET /v1/posts?tag= 里用得到的字段。 */
interface FeedPage {
  items: {
    id: string;
    title: string;
    excerpt: string;
    tags?: { name: string; slug: string }[];
  }[];
}

/** 页面里列出的帖子数，也是向接口要的条数。 */
const LIMIT = 30;

async function load(env: Env, slug: string): Promise<LoadResult> {
  const page = await fetchApi<FeedPage>(
    env,
    `/v1/posts?tag=${encodeURIComponent(slug)}&limit=${LIMIT}`,
  );
  if (page === "not_found" || "failed" in page) return page;

  const name = page.items.flatMap((p) => p.tags ?? []).find((t) => t.slug === slug)?.name || slug;
  const title = `${name}相关帖子 - 绝区零绳网`;
  const path = `/tags/${encodeURIComponent(slug)}`;
  const titles = page.items.slice(0, 5).map((p) => p.title).join("、");
  const description = truncate(
    titles ? `绳网上关于「${name}」的讨论：${titles}` : `绳网上关于「${name}」的讨论`,
    160,
  );
  const items = page.items
    .map((p) => {
      const href = `/post/${encodeURIComponent(p.id)}`;
      const excerpt = p.excerpt ? `<p>${escapeHtml(truncate(p.excerpt, 120))}</p>` : "";
      return `<li><a href="${href}">${escapeHtml(p.title)}</a>${excerpt}</li>`;
    })
    .join("");

  return {
    title,
    description,
    ogType: "website",
    // 没有帖子的标签是空页面，不收录。
    noindex: page.items.length === 0,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      url: `${siteOrigin(env)}${path}`,
      about: name,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: page.items.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${siteOrigin(env)}/post/${encodeURIComponent(p.id)}`,
          name: p.title,
        })),
      },
    },
    bodyHtml: `<main><h1>#${escapeHtml(name)}</h1><ul>${items}</ul></main>`,
  };
}

/** Pages 给的路径参数没有解码（中文标签是 %E6… 形式），这里解码一次。 */
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const onRequestGet: PagesFunction<Env, "slug"> = ({ request, env, params }) =>
  renderShell(request, env, () => load(env, decodeSlug(String(params.slug))));
