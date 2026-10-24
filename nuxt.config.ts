import { defineNuxtConfig } from "nuxt/config";
import { fileURLToPath } from "node:url";

/** 本地开发时 ik-server 的地址（dev 代理与实时通道直连用）。 */
const devApiOrigin = (process.env.NUXT_DEV_API_PROXY || "http://localhost:8080").replace(/\/+$/, "");

const zzzuiPackages = fileURLToPath(new URL("./zzzui/packages", import.meta.url));
const zzzuiSrc = fileURLToPath(new URL("./zzzui/src", import.meta.url));

export default defineNuxtConfig({
  compatibilityDate: "2025-07-01",
  srcDir: "app/",
  modules: ["@pinia/nuxt"],
  ssr: false,
  nitro: {
    preset: "static",
    // 本地开发：/v1 转发到 ik-server，保持同源，会话 Cookie 与 CSRF 校验和线上
    //（nginx 同源反代）一致。Host 原样转发（不改 origin）。
    // 开发服务器不转发 WebSocket 升级，实时通道见 runtimeConfig.public.realtimeUrl。
    devProxy: {
      "/v1": {
        target: `${devApiOrigin}/v1`,
        changeOrigin: false,
      },
    },
  },
  css: ["~/assets/styles/theme.css"],
  runtimeConfig: {
    public: {
      // 接口与网页同源（生产由 nginx 把 /v1 反代到 ik-server），默认留空。
      // 本地 dev 走下面的 vite 代理；只有直连别的后端地址时才设 NUXT_PUBLIC_API_BASE_URL。
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || "",
      // 实时通道（WebSocket）地址；留空 = 与接口同源的 /v1/realtime。
      // 本地 dev 直连 ik-server（Cookie 不分端口；ik-server 的 allowed_origins 要包含 dev 页面的源）。
      realtimeUrl: process.env.NUXT_PUBLIC_REALTIME_URL
        || (process.env.NODE_ENV === "development" ? `${devApiOrigin.replace(/^http/, "ws")}/v1/realtime` : ""),
      appName: "绳网",
    },
  },
  app: {
    head: {
      title: "绳网",
      link: [
        // 浏览器标签页与搜索引擎使用标准 16/32/48 像素图标；高分屏和移动端使用更大尺寸。
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/icon/favicon-16x16.png" },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/icon/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "48x48", href: "/icon/favicon-48x48.png" },
        { rel: "icon", type: "image/png", sizes: "96x96", href: "/icon/globe-96x96.png" },
        { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon/android-chrome-192x192.png" },
        { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon/android-chrome-512x512.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/icon/apple-touch-icon-180x180.png" },
        // 首屏关键图片预加载：SPA loading 屏的 GIF。
        // 目的：避免生产环境下 JS 挂载早于 GIF 解码导致 loading 屏一闪而过。
        { rel: "preload", as: "image", href: "/images/loading.gif", fetchpriority: "high" },
        { rel: "preconnect", href: "https://im.tiwat.cn" },
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
        { name: "application-name", content: "绳网" },
        { name: "description", content: "新艾利都最大的匿名委托中枢。" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "绳网" },
        { property: "og:title", content: "绳网" },
        { property: "og:description", content: "新艾利都最大的匿名委托中枢。" },
        { property: "og:image", content: "/icon/globe-512x512.png" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      script: [
        {
          type: "application/ld+json",
          innerHTML: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "绳网",
            alternateName: "INTER-KNOT",
            description: "新艾利都最大的匿名委托中枢。",
            url: "https://interk.net/",
          }),
        },
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
