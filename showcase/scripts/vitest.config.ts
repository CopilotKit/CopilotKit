import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    // Teardown / setup hook timeouts bumped from the 10s vitest default.
    // Under Node 20, when a test file has spawned a large number of
    // subprocesses (validate-pins runs 134 subprocesses; create-integration /
    // generate-registry / bundle-demo-content each spawn `npx tsx`), vitest's
    // worker-RPC channel ("Timeout calling 'onTaskUpdate'") times out during
    // teardown under the combined load. Known upstream bug:
    //   https://github.com/vitest-dev/vitest/issues/6129
    // The 30s budget matches our testTimeout so a slow teardown can't be the
    // bottleneck that kills the run.
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
    // `singleFork: true` — one fork shared across ALL test files (combined
    // with fileParallelism: false, files still run sequentially). A
    // previous revision used fork-per-file (the default under pool:
    // "forks"), but unit (20.x) CI still emitted the onTaskUpdate timeout
    // mid-run (see run 24602657301). With one long-lived fork, the
    // parent↔child RPC channel stays warm instead of being torn down and
    // re-established between every file — each teardown is one of the
    // moments the Node-20 RPC race surfaces. This is the most conservative
    // setting short of dropping to a single-thread pool entirely.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Exclude Playwright E2E tests — they use @playwright/test, not vitest.
    // Also exclude fixture *.spec.ts files under __tests__/fixtures/** —
    // these are inert data files consumed by validate-parity tests, not
    // real vitest suites, and vitest's default glob would otherwise pick
    // them up and fail with "No test suite found".
    exclude: ["__tests__/e2e/**", "__tests__/fixtures/**", "node_modules/**"],
  },
});
