import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Backend instrumentation, agent state regression tests, and local
    // transcription endpoint resolution. The broader suite is Playwright e2e
    // (`test:e2e`); these run without the Next.js build toolchain.
    include: [
      "src/cvdiag-backend.test.ts",
      "src/agent/*.test.ts",
      "src/lib/transcription-base-url.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
