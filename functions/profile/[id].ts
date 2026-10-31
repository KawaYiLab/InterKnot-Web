import {
  type Env,
  type LoadResult,
  escapeHtml,
  fetchApi,
  renderShell,
  siteOrigin,
  truncate,
} from "../../edge/seo";

/** GET /v1/users/{id} 里用得到的字段。 */
interface ProfileView {
  id: string;
  username: string;
  bio?: string;
  level?: number;
  joinedAt?: string;
  isHidden?: boolean;
  avatar?: { url: string };
  equippedAvatar?: { image?: string };
  followerCount?: number;
  stats?: { postCount?: number };
}

const DEFAULT_IMAGE = "/images/zzzicon_200x200.png";

async function load(env: Env, id: string): Promise<LoadResult> {
  const p = await fetchApi<ProfileView>(env, `/v1/users/${encodeURIComponent(id)}`);
  if (p === "not_found" || "failed" in p) return p;

  const name = p.username || "用户";
  const title = `${name}的主页 - 绝区零绳网`;
  const bio = (p.bio || "").replace(/\s+/g, " ").trim();
  const description = truncate(bio || `查看 ${name} 在绳网上的委托和评论`, 160);
  const image = p.avatar?.url || p.equippedAvatar?.image || DEFAULT_IMAGE;
  const url = `${siteOrigin(env)}/profile/${encodeURIComponent(p.id)}`;

  return {
    title,
    description,
    image,
    ogType: "profile",
    // 对方隐藏了主页时接口只给精简视图，不收录。
    noindex: p.isHidden === true,
    extraMeta: { "profile:username": name },
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      url,
      ...(p.joinedAt ? { dateCreated: p.joinedAt } : {}),
      mainEntity: {
        "@type": "Person",
        name,
        url,
        ...(bio ? { description: truncate(bio, 300) } : {}),
        interactionStatistic: [
          { "@type": "InteractionCounter", interactionType: "https://schema.org/FollowAction", userInteractionCount: p.followerCount ?? 0 },
          { "@type": "InteractionCounter", interactionType: "https://schema.org/WriteAction", userInteractionCount: p.stats?.postCount ?? 0 },
        ],
      },
    },
    bodyHtml: `<main><h1>${escapeHtml(name)}</h1>${bio ? `<p>${escapeHtml(bio)}</p>` : ""}`
      + `<p><a href="/profile/${encodeURIComponent(p.id)}/posts">${escapeHtml(name)}的全部委托</a></p></main>`,
  };
}

export const onRequestGet: PagesFunction<Env, "id"> = ({ request, env, params }) =>
  renderShell(request, env, () => load(env, String(params.id)));
