import { onRequestGet as __post__id__ts_onRequestGet } from "/home/claude/InterKnot-Web/functions/post/[id].ts"
import { onRequestGet as __profile__id__ts_onRequestGet } from "/home/claude/InterKnot-Web/functions/profile/[id].ts"
import { onRequestGet as __sitemap_xml_ts_onRequestGet } from "/home/claude/InterKnot-Web/functions/sitemap.xml.ts"

export const routes = [
    {
      routePath: "/post/:id",
      mountPath: "/post",
      method: "GET",
      middlewares: [],
      modules: [__post__id__ts_onRequestGet],
    },
  {
      routePath: "/profile/:id",
      mountPath: "/profile",
      method: "GET",
      middlewares: [],
      modules: [__profile__id__ts_onRequestGet],
    },
  {
      routePath: "/sitemap.xml",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__sitemap_xml_ts_onRequestGet],
    },
  ]