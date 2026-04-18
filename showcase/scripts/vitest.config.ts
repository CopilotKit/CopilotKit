import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    // Run test files sequentially — several suites mutate process env and temp dirs
    // that would race under parallel execution: create-integration vs generate-registry
    // for tmp dir reuse; validate-pins / validate-parity / audit subprocess tests for
    // VALIDATE_PINS_REPO_ROOT / VALIDATE_PARITY_REPO_ROOT / SHOWCASE_AUDIT_ROOT env vars.
    fileParallelism: false,
    // Exclude Playwright E2E tests — they use @playwright/test, not vitest.
    // Also exclude fixture *.spec.ts files under __tests__/fixtures/** —
    // these are inert data files consumed by validate-parity tests, not
    // real vitest suites, and vitest's default glob would otherwise pick
    // them up and fail with "No test suite found".
    exclude: ["__tests__/e2e/**", "__tests__/fixtures/**", "node_modules/**"],
  },
});
