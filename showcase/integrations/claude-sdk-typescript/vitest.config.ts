import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Fast backend unit tests that run inside the integration image build.
    // The broader suite is Playwright e2e (`test:e2e`); these files stay
    // network-free and run without the Next.js build toolchain.
    include: [
      "src/cvdiag-backend.test.ts",
      "src/claude-agent-sdk-adapter.test.ts",
      // This integration keeps its own copy of the shared tools (see
      // showcase/AGENTS.md on symlink drift); their tests run here.
      "shared-tools/__tests__/*.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
