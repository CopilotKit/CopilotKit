import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Small backend unit contracts (CVDIAG plus the shared voice
    // transcription service). The integration's broader suite is Playwright
    // e2e (`test:e2e`), so keep this independent of the Next.js build
    // toolchain.
    include: [
      "src/cvdiag-backend.test.ts",
      "src/lib/voice-transcription-service.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
