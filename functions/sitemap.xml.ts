import { type Env, apiOrigin } from "../edge/seo";

/** 把 ik-server 生成的 sitemap 挂到 interk.net/sitemap.xml，搜索引擎要求同域。 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const res = await fetch(`${apiOrigin(env)}/v1/sitemap.xml`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) return new Response("sitemap unavailable", { status: 502 });
  return new Response(res.body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
