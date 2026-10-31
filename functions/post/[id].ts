import {
  type Env,
  type LoadResult,
  absolute,
  escapeHtml,
  fetchApi,
  markdownToParagraphs,
  renderShell,
  siteOrigin,
  truncate,
} from "../../edge/seo";

/** GET /v1/posts/{id} 里用得到的字段。 */
interface PostDetail {
  id: string;
  title: string;
  body: string;
  covers?: { url: string }[];
  externalVideos?: { coverUrl?: string }[];
  author: { id?: string | null; name: string; anonymous: boolean };
  tags?: { name: string; slug: string }[];
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  publishedAt: string;
  editedAt?: string | null;
  isHidden?: boolean;
}

const DEFAULT_IMAGE = "/images/zzzicon_200x200.png";
/** 写进 HTML 的正文上限（字符）。 */
const BODY_MAX = 5000;

async function load(env: Env, id: string): Promise<LoadResult> {
  const post = await fetchApi<PostDetail>(env, `/v1/posts/${encodeURIComponent(id)}`);
  if (post === "not_found" || "failed" in post) return post;

  const paragraphs = markdownToParagraphs(post.body || "");
  const plain = paragraphs.join(" ");
  const description = truncate(plain, 160) || "绳网是一个游戏、技术交流平台";
  const title = `${post.title || "无标题"} - 绳网`;
  const image = post.covers?.[0]?.url || post.externalVideos?.[0]?.coverUrl || DEFAULT_IMAGE;
  const url = `${siteOrigin(env)}/post/${encodeURIComponent(post.id)}`;
  const authorUrl = !post.author.anonymous && post.author.id
    ? `${siteOrigin(env)}/profile/${encodeURIComponent(post.author.id)}`
    : undefined;
  const modified = post.editedAt || post.publishedAt;

  let used = 0;
  const bodyParas: string[] = [];
  for (const p of paragraphs) {
    if (used >= BODY_MAX) break;
    const piece = truncate(p, BODY_MAX - used);
    used += piece.length;
    bodyParas.push(`<p>${escapeHtml(piece)}</p>`);
  }
  const author = authorUrl
    ? `<a href="${escapeHtml(authorUrl)}">${escapeHtml(post.author.name)}</a>`
    : escapeHtml(post.author.name);
  const tags = (post.tags ?? [])
    .map((t) => `<a href="/tags/${encodeURIComponent(t.slug)}">#${escapeHtml(t.name)}</a>`)
    .join(" ");
  const bodyHtml = `<article><h1>${escapeHtml(post.title || "无标题")}</h1>`
    + `<p>${author} · <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.publishedAt.slice(0, 10))}</time></p>`
    + bodyParas.join("")
    + (tags ? `<p>${tags}</p>` : "")
    + `</article>`;

  return {
    title,
    description,
    image,
    ogType: "article",
    noindex: post.isHidden === true,
    extraMeta: {
      "article:published_time": post.publishedAt,
      "article:modified_time": modified,
      ...(post.tags?.[0] ? { "article:tag": post.tags[0].name } : {}),
    },
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "DiscussionForumPosting",
      headline: truncate(post.title || "无标题", 110),
      text: truncate(plain, BODY_MAX),
      url,
      image: absolute(env, image),
      datePublished: post.publishedAt,
      dateModified: modified,
      author: authorUrl
        ? { "@type": "Person", name: post.author.name, url: authorUrl }
        : { "@type": "Person", name: post.author.name },
      commentCount: post.commentCount ?? 0,
      interactionStatistic: [
        { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: post.likeCount ?? 0 },
        { "@type": "InteractionCounter", interactionType: "https://schema.org/ViewAction", userInteractionCount: post.viewCount ?? 0 },
      ],
      keywords: (post.tags ?? []).map((t) => t.name).join(",") || undefined,
    },
    bodyHtml,
  };
}

export const onRequestGet: PagesFunction<Env, "id"> = ({ request, env, params }) =>
  renderShell(request, env, () => load(env, String(params.id)));
