import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    svelte(),
    dts({
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
      outDir: "dist",
      include: ["src/**/*.ts", "src/**/*.svelte"],
      exclude: ["src/**/__tests__/**"],
      rollupTypes: true,
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "CopilotKitSvelte",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.cjs"),
    },
    rollupOptions: {
      external: [
        "svelte",
        "svelte/store",
        "svelte/reactivity",
        "@ag-ui/client",
        "@ag-ui/core",
        "@copilotkit/core",
        "@copilotkit/shared",
        "@copilotkit/web-inspector",
        /^@copilotkit\/web-components(\/.*)?$/,
        "@jetbrains/websandbox",
        "katex",
        "zod",
        "zod-to-json-schema",
      ],
      output: {
        globals: { svelte: "Svelte" },
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
