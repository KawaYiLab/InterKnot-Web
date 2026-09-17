import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("./app/", import.meta.url));

export default defineConfig({
  plugins: [vue(), {
    name: "nuxt-client-env",
    enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").includes("/app/")) {
        return code.replaceAll("import.meta.client", "true");
      }
    },
  }],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "~": appDir,
      "@": appDir,
      "zenless-ui": fileURLToPath(new URL("./zzzui/packages/", import.meta.url)),
    },
  },
});
