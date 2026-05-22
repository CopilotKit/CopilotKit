import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for the CopilotKit Studio SPA.
 *
 * The SPA is built to `dist/spa/` and served by the launcher's http server
 * (see `src/launcher/http-server.ts`). The launcher itself is compiled
 * separately via `tsconfig.launcher.json`.
 */
export default defineConfig({
  root: resolve(__dirname, "src/spa"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/spa"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Multi-page build — `index.html` is the main app, `timeline-demo.html`
      // is the M5 demo harness. Engineers run `vite preview` (or `vite dev`)
      // and visit `/timeline-demo.html` to eyeball the drawer in isolation.
      input: {
        index: resolve(__dirname, "src/spa/index.html"),
        timelineDemo: resolve(__dirname, "src/spa/timeline-demo.html"),
      },
    },
  },
  server: {
    port: 4124,
  },
});
