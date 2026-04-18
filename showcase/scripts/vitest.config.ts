import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    // Teardown / setup hook timeouts bumped from the 10s vitest default.
    // Under Node 20, when a test file has spawned a large number of
    // subprocesses (validate-pins runs 134 subprocesses; create-integration /
    // generate-registry / bundle-demo-content each spawn `npx tsx`), vitest's
    // per-hook timeouts can fire during slow teardown under the combined
    // load. Bumping to 30s matches our testTimeout. Note: the vitest
    // worker-RPC "onTaskUpdate" timeout is a SEPARATE, hardcoded 60s in
    // birpc (DEFAULT_TIMEOUT = 6e4 in index.B521nVV-.js) — these knobs
    // do NOT influence it. The RPC timeout is tracked upstream:
    //   https://github.com/vitest-dev/vitest/issues/6129
    teardownTimeout: 30000,
    hookTimeout: 30000,
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
    // ONE FORK PER FILE (the fork-pool default), combined with
    // fileParallelism: false — files still run sequentially so shared-env
    // mutations don't race, but each file gets a fresh process with a
    // fresh RPC channel. A previous revision tried `singleFork: true` (one
    // long-lived fork across all files) but observed run 24602985507 went
    // STRICTLY WORSE: only 1/14 files completed before the RPC timeout
    // fired, because validate-pins on its own takes 60s on Node 20 CI and
    // blocks the fork's single RPC channel for that entire duration. With
    // fork-per-file, each file gets its own fresh 60s RPC budget.
    pool: "forks",
    // Exclude Playwright E2E tests — they use @playwright/test, not vitest.
    // Also exclude fixture *.spec.ts files under __tests__/fixtures/** —
    // these are inert data files consumed by validate-parity tests, not
    // real vitest suites, and vitest's default glob would otherwise pick
    // them up and fail with "No test suite found".
    exclude: ["__tests__/e2e/**", "__tests__/fixtures/**", "node_modules/**"],
  },
});
