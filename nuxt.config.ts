import { defineNuxtConfig } from "nuxt/config";
import { fileURLToPath } from "node:url";

const zzzuiPackages = fileURLToPath(new URL("./zzzui/packages", import.meta.url));
const zzzuiSrc = fileURLToPath(new URL("./zzzui/src", import.meta.url));

// 站点规范域名：用于 canonical、og:image 绝对地址、sitemap。
// 通过 NUXT_PUBLIC_SITE_URL 覆盖（生产请填实际对外域名）。
const SITE_URL = process.env.NUXT_PUBLIC_SITE_URL || "https://interknot.tiwat.cn";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-01",
  srcDir: "app/",
  modules: ["@pinia/nuxt", "@nuxtjs/sitemap"],
  // 开启 SSR：公共内容（帖子 / 用户主页）服务端渲染，爬虫可直接抓到正文与元信息。
  ssr: true,
  nitro: {
    // 由静态 SPA 改为 Node 服务端渲染。部署时按平台调整 preset
    // （如 vercel / netlify / cloudflare-pages 等）。
    preset: "node-server",
  },
  // 混合渲染：公共页 SSR + 增量静态/SWR；交互/鉴权页保持纯客户端渲染。
  routeRules: {
    "/": { isr: 60 },
    "/post/**": { isr: 300 },
    "/profile/**": { swr: 600 },
    "/create": { ssr: false },
    "/exam": { ssr: false },
    "/login": { ssr: false },
    "/knock": { ssr: false },
  },
  sitemap: {
    // 动态 URL 来源：服务端按已发布帖子 / 分类生成。
    sources: ["/api/__sitemap__/urls"],
    exclude: ["/create", "/exam", "/login", "/knock", "/profile/**"],
  },
  css: ["~/assets/styles/theme.css"],
  runtimeConfig: {
    public: {
      apiBaseUrl: "",
      appName: "绳网",
      siteUrl: SITE_URL,
    },
  },
  app: {
    head: {
      title: "绳网",
      link: [
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        // 首屏关键图片预加载：SPA loading 屏的 GIF 与首页底图 main.avif
        // 目的：避免生产环境下 JS 挂载早于 GIF 解码导致 loading 屏一闪而过，
        // 以及 #__nuxt::before 背景图未就绪出现的"黑屏"过渡。
        { rel: "preload", as: "image", href: "/images/loading.gif", fetchpriority: "high" },
        { rel: "preload", as: "image", href: "/images/main.avif", fetchpriority: "high" },
        { rel: "preconnect", href: "https://image.tiwat.cn" },
      ],
      htmlAttrs: {
        lang: "zh-CN",
      },
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { name: "color-scheme", content: "dark" },
        { name: "theme-color", content: "#000000" },
        { name: "description", content: "绳网是一个游戏、技术交流平台" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "绳网" },
        { property: "og:title", content: "绳网" },
        { property: "og:description", content: "绳网是一个游戏、技术交流平台" },
        { property: "og:image", content: `${SITE_URL}/images/zzzicon_200x200.png` },
        { property: "og:url", content: SITE_URL },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "绳网" },
        { name: "twitter:description", content: "绳网是一个游戏、技术交流平台" },
        { name: "twitter:image", content: `${SITE_URL}/images/zzzicon_200x200.png` },
      ],
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  sourcemap: {
    client: true,
  },
  vite: {
    optimizeDeps: {
      include: [
        '@tanstack/vue-query',
        'throttle-debounce',
        '@vueuse/core',
        '@heroicons/vue/24/outline',
        '@heroicons/vue/24/solid',
        'vue-advanced-cropper',
        'isomorphic-dompurify',
        'markdown-it',
        'lightgallery',
        'lightgallery/plugins/zoom',
        'lightgallery/plugins/thumbnail',
        'lightgallery/plugins/fullscreen',
        'lightgallery/plugins/rotate',
        'lightgallery/plugins/autoplay',
      ],
    },
    resolve: {
      alias: {
        "zenless-ui": zzzuiPackages,
        "@src": zzzuiSrc,
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@import 'zenless-ui/theme/var.scss';\n`,
          silenceDeprecations: ['import', 'global-builtin'],
        },
      },
    },
  },
});
