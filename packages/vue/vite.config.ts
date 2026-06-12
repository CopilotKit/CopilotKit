import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "v2/index": resolve(__dirname, "src/v2/index.ts"),
      },
      name: "CopilotKitVue",
      formats: ["es", "cjs"],
      fileName: (format, entryName) =>
        format === "es" ? `${entryName}.mjs` : `${entryName}.cjs`,
    },
    rollupOptions: {
      external: [
        "vue",
        "@a2ui/web_core",
        "@a2ui/web_core/v0_9",
        "@a2ui/web_core/v0_9/basic_catalog",
        "@ag-ui/client",
        "@ag-ui/core",
        "@copilotkit/core",
        "@copilotkit/shared",
        "@copilotkit/web-inspector",
        "@jetbrains/websandbox",
        "streamdown-vue",
        "katex",
        "lucide-vue-next",
        "zod",
        "zod-to-json-schema",
      ],
      output: {
        globals: { vue: "Vue" },
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
