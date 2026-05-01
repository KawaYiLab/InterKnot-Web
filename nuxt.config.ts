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
    prerender: {
      routes: ["/", "/login"],
    },
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
        { rel: "stylesheet", href: "/fonts/fonts.css" },
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
