import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    // Run test files sequentially — create-integration creates temp dirs
    // that generate-registry would choke on if run concurrently
    fileParallelism: false,
    // Exclude Playwright E2E tests — they use @playwright/test, not vitest
    exclude: ["__tests__/e2e/**", "node_modules/**"],
  },
});
