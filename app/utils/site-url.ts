/** 把站内路径拼成带域名的绝对地址；已是绝对地址（含协议相对 //）的原样返回。 */
export function absoluteSiteUrl(pathOrUrl: string): string {
  if (/^(https?:)?\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = String(useRuntimeConfig().public.siteUrl || "").replace(/\/+$/, "");
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
