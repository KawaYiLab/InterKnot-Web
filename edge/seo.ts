/**
 * Cloudflare Pages Functions 共用：给 SPA 外壳写入页面级 SEO 信息。
 *
 * 前端是纯 SPA（ssr: false），静态 HTML 里只有全站通用的 title / 描述。
 * 帖子页、个人页命中 functions/ 下的函数后，这里先向 ik-server 取数据，
 * 再用 HTMLRewriter 改写 index.html：title、描述、OG、canonical、JSON-LD，
 * 并在 #__nuxt 里放一份正文纯文本（Vue 挂载时会整块替换掉）。
 * 接口超时或出错时原样返回外壳，用户侧行为和没有这个函数时一样。
 * 响应头 `x-ik-seo` 写明结果：ok / not-found / api-timeout / api-<状态码> 等。
 */

export interface Env {
  ASSETS: { fetch: (input: Request | URL | string, init?: RequestInit) => Promise<Response> };
  /** ik-server 地址，默认 https://ik.tiwat.cn。 */
  IK_API_ORIGIN?: string;
  /** 站点对外地址，默认 https://interk.net。 */
  SITE_URL?: string;
}

export interface PageSeo {
  title: string;
  description: string;
  image?: string;
  ogType: "article" | "profile" | "website";
  /** 额外的 meta property（如 article:published_time）。 */
  extraMeta?: Record<string, string>;
  jsonLd?: unknown;
  /** 放进 #__nuxt 的 HTML，调用方负责转义。 */
  bodyHtml?: string;
  noindex?: boolean;
}

/** 接口没拿到数据的原因，写进响应头 `x-ik-seo` 方便排查。 */
export interface ApiFailure {
  failed: string;
}

export type LoadResult = PageSeo | "not_found" | ApiFailure;

const isFailure = (v: unknown): v is ApiFailure =>
  typeof v === "object" && v !== null && "failed" in v;

const DEFAULT_API = "https://ik.tiwat.cn";
const DEFAULT_SITE = "https://interk.net";
// Cloudflare 边缘到 ik.tiwat.cn（EdgeOne）跨境，冷请求 1.5 秒不够。
const API_TIMEOUT_MS = 4000;
/** 边缘缓存接口响应的秒数，同一帖子 5 分钟内只回源一次。 */
const API_CACHE_TTL = 300;

export const apiOrigin = (env: Env) => (env.IK_API_ORIGIN || DEFAULT_API).replace(/\/+$/, "");
export const siteOrigin = (env: Env) => (env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");

/** 匿名请求 ik-server。404 返回 "not_found"，其它失败返回原因。 */
export async function fetchApi<T>(env: Env, path: string): Promise<T | "not_found" | ApiFailure> {
  let res: Response;
  try {
    res = await fetch(`${apiOrigin(env)}${path}`, {
      headers: { accept: "application/json", "user-agent": "interknot-pages-seo/1.0" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      cf: { cacheTtl: API_CACHE_TTL, cacheEverything: true },
    } as RequestInit);
  } catch (err) {
    return { failed: err instanceof Error && err.name === "TimeoutError" ? "api-timeout" : "api-network" };
  }
  if (res.status === 404) return "not_found";
  if (!res.ok) return { failed: `api-${res.status}` };
  try {
    return (await res.json()) as T;
  } catch {
    return { failed: "api-not-json" };
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 去掉 HTML 标签：由内向外反复删到不再变化，嵌套的 `<scr<script>ipt>` 也删得干净；
 * 剩下的孤立尖括号在 markdownToParagraphs 里换成空格。输出时还会再转义一次。
 */
function stripTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^<>\n]*>/g, "");
  } while (s !== prev);
  return s;
}

/**
 * 帖子正文 Markdown 转纯文本，保留段落。规则与前端 utils/card-excerpt.ts 一致：
 * 去掉 @提及语法、表情、图片、链接地址和 HTML 标签。
 */
export function markdownToParagraphs(md: string): string[] {
  const text = stripTags(md)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/@\[([^\[\]\n]{1,40})\]\([A-Za-z0-9]{1,32}\)/g, "@$1")
    .replace(/:(ik-[a-z0-9-]{1,32}):/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[<>]/g, " ")
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]{1,3}/g, "");
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 站内路径转绝对地址；已带协议的原样返回。 */
export function absolute(env: Env, url: string): string {
  if (/^(https?:)?\/\//i.test(url)) return url;
  return `${siteOrigin(env)}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** JSON-LD 放进 <script> 时防止 </script> 截断。 */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

class SetContent {
  private readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  element(el: Element) {
    el.setAttribute("content", this.value);
  }
}

/**
 * 取 SPA 外壳并写入 SEO 信息。load 返回失败原因（接口不可用）时原样返回外壳；
 * 返回 "not_found" 时以 404 状态返回外壳，页面仍由前端显示「找不到」。
 */
async function render(
  request: Request,
  env: Env,
  load: () => Promise<LoadResult>,
): Promise<Response> {
  const [shell, seo] = await Promise.all([
    env.ASSETS.fetch(new URL("/", request.url)),
    load().catch((): ApiFailure => ({ failed: "load-error" })),
  ]);
  if (!shell.ok) return shell;

  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  if (isFailure(seo)) {
    headers.set("x-ik-seo", seo.failed);
    return new Response(shell.body, { status: shell.status, headers });
  }
  headers.set("x-ik-seo", seo === "not_found" ? "not-found" : "ok");

  if (seo === "not_found") {
    const res = new HTMLRewriter()
      .on("head", {
        element(el) {
          el.append('<meta name="robots" content="noindex">', { html: true });
        },
      })
      .transform(shell);
    return new Response(res.body, { status: 404, headers });
  }

  const canonical = siteOrigin(env) + new URL(request.url).pathname;
  const image = seo.image ? absolute(env, seo.image) : undefined;
  let headExtra = `<link rel="canonical" href="${escapeHtml(canonical)}">`
    + `<meta property="og:url" content="${escapeHtml(canonical)}">`;
  for (const [k, v] of Object.entries(seo.extraMeta ?? {})) {
    headExtra += `<meta property="${escapeHtml(k)}" content="${escapeHtml(v)}">`;
  }
  if (seo.noindex) headExtra += '<meta name="robots" content="noindex">';
  if (seo.jsonLd) headExtra += `<script type="application/ld+json">${jsonForScript(seo.jsonLd)}</script>`;

  let rewriter = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(seo.title);
      },
    })
    .on('meta[name="description"]', new SetContent(seo.description))
    .on('meta[property="og:title"]', new SetContent(seo.title))
    .on('meta[property="og:description"]', new SetContent(seo.description))
    .on('meta[property="og:type"]', new SetContent(seo.ogType))
    .on("head", {
      element(el) {
        el.append(headExtra, { html: true });
      },
    });
  if (image) rewriter = rewriter.on('meta[property="og:image"]', new SetContent(image));
  if (seo.bodyHtml && !seo.noindex) {
    const bodyHtml = seo.bodyHtml;
    rewriter = rewriter.on("div#__nuxt", {
      element(el) {
        el.setInnerContent(bodyHtml, { html: true });
      },
    });
  }

  const res = rewriter.transform(shell);
  return new Response(res.body, { status: 200, headers });
}

/**
 * 取 SPA 外壳并写入 SEO 信息（见 render）。改写过程中任何异常都回落为原外壳，
 * 不能让一条数据的格式问题把整个页面变成 500。
 */
export async function renderShell(
  request: Request,
  env: Env,
  load: () => Promise<LoadResult>,
): Promise<Response> {
  try {
    return await render(request, env, load);
  } catch {
    const shell = await env.ASSETS.fetch(new URL("/", request.url));
    const headers = new Headers(shell.headers);
    headers.set("x-ik-seo", "render-error");
    return new Response(shell.body, { status: shell.status, headers });
  }
}
