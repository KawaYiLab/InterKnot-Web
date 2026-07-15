import { defineNuxtConfig } from "nuxt/config";
import { fileURLToPath } from "node:url";

const zzzuiPackages = fileURLToPath(new URL("./zzzui/packages", import.meta.url));
const zzzuiSrc = fileURLToPath(new URL("./zzzui/src", import.meta.url));

export default defineNuxtConfig({
  compatibilityDate: "2025-07-01",
  srcDir: "app/",
  modules: ["@pinia/nuxt"],
  ssr: false,
  nitro: {
    preset: "static",
  },
  css: ["~/assets/styles/theme.css"],
  runtimeConfig: {
    public: {
      // 本地 dev 或 Pages 預覽構建可通過 .env 的 NUXT_PUBLIC_API_BASE_URL 指定後端地址。
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || "",
      appName: "绳网",
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
        { name: "description", content: "绳网是一个游戏、技术交流平台" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "绳网" },
        { property: "og:title", content: "绳网" },
        { property: "og:description", content: "绳网是一个游戏、技术交流平台" },
        { property: "og:image", content: "/images/zzzicon_200x200.png" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      script: [
        // Cloudflare Web Analytics
        {
          src: "https://static.cloudflareinsights.com/beacon.min.js",
          defer: true,
          "data-cf-beacon": '{"token": "87a21c330b51466ca19ec0b32ff89a51"}',
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
