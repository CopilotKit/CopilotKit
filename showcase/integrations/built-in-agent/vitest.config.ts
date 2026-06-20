import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // CVDIAG backend instrumentation unit tests (L1-E). The integration's
    // broader suite is Playwright e2e (`test:e2e`); this config scopes vitest
    // to the co-located cvdiag unit tests so they run without the Next.js
    // build toolchain.
    include: ["src/cvdiag-backend.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
