import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    // Run test files sequentially — several suites mutate process env and temp dirs
    // that would race under parallel execution: create-integration vs generate-registry
    // for tmp dir reuse; validate-pins / validate-parity / audit subprocess tests for
    // VALIDATE_PINS_REPO_ROOT / VALIDATE_PARITY_REPO_ROOT / SHOWCASE_AUDIT_ROOT env vars.
    fileParallelism: false,
    // Use process forks instead of the default thread pool. Under Node 20 the
    // thread-based worker RPC channel times out ("Timeout calling
    // onTaskUpdate") when a test file spawns many subprocesses
    // (validate-pins.test.ts runs 134 tests each invoking a subprocess;
    // create-integration / generate-registry / bundle-demo-content each
    // spawn npx tsx). The stdio / signal traffic from these children
    // contends with the vitest worker-thread RPC channel and surfaces as
    // an unhandled timeout. Fork-based pools use node IPC (not worker
    // threads) for the RPC, which is robust under the same load.
    // Node 22/24 are unaffected either way.
    //
    // One fork per file (default) — combined with fileParallelism: false,
    // files still run sequentially so shared-env mutations don't race, but
    // each file gets a fresh process so one file's subprocess churn can't
    // stall the RPC for subsequent files.
    pool: "forks",
    // Exclude Playwright E2E tests — they use @playwright/test, not vitest.
    // Also exclude fixture *.spec.ts files under __tests__/fixtures/** —
    // these are inert data files consumed by validate-parity tests, not
    // real vitest suites, and vitest's default glob would otherwise pick
    // them up and fail with "No test suite found".
    exclude: ["__tests__/e2e/**", "__tests__/fixtures/**", "node_modules/**"],
  },
});
