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
        "v2/generative-ui/index": resolve(
          __dirname,
          "src/v2/generative-ui/index.ts",
        ),
        "v2/generative-ui/chart": resolve(
          __dirname,
          "src/v2/generative-ui-chart/index.ts",
        ),
        "v2/generative-ui/map": resolve(
          __dirname,
          "src/v2/generative-ui-map/index.ts",
        ),
      },
      name: "CopilotKitVue",
      formats: ["es", "cjs"],
      fileName: (format, entryName) =>
        format === "es" ? `${entryName}.mjs` : `${entryName}.cjs`,
    },
    rollupOptions: {
      external: [
        "vue",
        "@ag-ui/client",
        "@ag-ui/core",
        // Core and its subpaths: `/styles`, so the stylesheet isn't bundled
        // here, and the framework-free `/generative-ui` layer the Vue
        // generative UI wraps.
        /^@copilotkit\/core(\/.*)?$/,
        // Keep the shared MCP Apps host + its subpaths external. The root entry
        // carries the ext-apps AppBridge and is loaded through a dynamic
        // import() in the renderer, so it must stay a real runtime import (not
        // be inlined, which would pull the bridge into the eager chunk and undo
        // the lazy-loading); `/activity` is the bridge-free surface imported
        // statically for activity registration.
        /^@copilotkit\/mcp-apps-renderer(\/.*)?$/,
        // Shared and its subpaths, such as `/generative-ui`.
        /^@copilotkit\/shared(\/.*)?$/,
        // The Inspector and its `/mount` subpath stay runtime imports.
        /^@copilotkit\/web-inspector(\/.*)?$/,
        // Keep @copilotkit/web-components (the Lit drawer element) + its subpaths
        // external. It's a runtime dependency loaded via the drawer wrapper's
        // client-only dynamic import; bundling it inline would ship a duplicate
        // element + a second copy of lit-html, which breaks Vite/Nuxt consumers
        // (duplicate top-level lit binding → "Identifier 'h' has already been
        // declared") and risks double custom-element registration.
        /^@copilotkit\/web-components(\/.*)?$/,
        /^zod(\/.*)?$/,
        // Optional peers of the generative UI icons and the chart and map
        // plugins. They load with a dynamic import(), so they stay imports.
        /^lucide(\/.*)?$/,
        /^chart\.js(\/.*)?$/,
        /^maplibre-gl(\/.*)?$/,
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
