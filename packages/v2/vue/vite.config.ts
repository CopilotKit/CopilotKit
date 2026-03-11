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
      entry: resolve(__dirname, "src/index.ts"),
      name: "CopilotKitVue",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.js"),
    },
    rollupOptions: {
      external: [
        "vue",
        "@ag-ui/client",
        "@ag-ui/core",
        "@copilotkitnext/core",
        "@copilotkitnext/shared",
        "@copilotkitnext/web-inspector",
        "streamdown-vue",
        "katex",
        "lucide-vue-next",
        "zod",
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
