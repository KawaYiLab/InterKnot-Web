import { defineNuxtConfig } from "nuxt/config";
import { fileURLToPath } from "node:url";

const zzzuiPackages = fileURLToPath(new URL("./zzzui/packages", import.meta.url));
const zzzuiSrc = fileURLToPath(new URL("./zzzui/src", import.meta.url));
const qiniuProvider = fileURLToPath(new URL("./app/providers/qiniu.ts", import.meta.url));

export default defineNuxtConfig({
  compatibilityDate: "2025-07-01",
  srcDir: "app/",
  modules: ["@pinia/nuxt", "@nuxt/image"],
  ssr: false,
  // 图片优化：image.tiwat.cn（七牛 + ESA）走自定义 provider 生成响应式 srcset
  // + 现代格式。开通七牛图片处理 / ESA 透传 query 后自动生效（详见 providers/qiniu.ts）。
  image: {
    provider: "qiniu",
    providers: {
      qiniu: {
        provider: qiniuProvider,
        options: {},
      },
    },
    domains: ["image.tiwat.cn"],
    quality: 80,
    // 现代格式：统一用 webp。注意 @nuxt/image 的 format / 全局 modifiers 配置不会
    // 下发到自定义 provider 的 modifiers（实测只有组件级 format 属性才生效），所以
    // webp 默认值放在 provider 内兜底（见 app/providers/qiniu.ts 的 DEFAULT_FORMAT），
    // 而非在此处配置。七牛 dora 的 avif 实测比 webp 大 ~20%，对本站是负优化，故只用 webp。
    screens: {
      xs: 320,
      sm: 480,
      md: 768,
      lg: 1024,
      xl: 1280,
      xxl: 1536,
    },
  },
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
