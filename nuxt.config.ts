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
      apiBaseUrl: "",
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
        // 首屏关键字体分片预加载：仅 Latin/常用范围的 Regular & Bold（中文分片由 unicode-range 按需触发）
        // 注：crossorigin 是 woff2 preload 的硬性要求，否则浏览器会发起第二次请求
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: "/fonts/HarmonyOS_SansSC_Regular/6a46ab7f.woff2",
          crossorigin: "anonymous",
        },
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: "/fonts/HarmonyOS_SansSC_Bold/6a46ab7f.woff2",
          crossorigin: "anonymous",
        },
        // fonts.css 改为 preload + onload swap，避免 72KB 字体声明阻塞首屏渲染
        {
          rel: "preload",
          as: "style",
          href: "/fonts/fonts.css",
          onload: "this.onload=null;this.rel='stylesheet'",
        },
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
        { name: "description", content: "绳网是一个游戏、技术交流平台" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "绳网" },
        { property: "og:title", content: "绳网" },
        { property: "og:description", content: "绳网是一个游戏、技术交流平台" },
        { property: "og:image", content: "/images/zzzicon_200x200.png" },
        { name: "twitter:card", content: "summary_large_image" },
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
