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
    // `pool: 'forks'` gives every file its own node process — env mutations
    // and module-level state are naturally isolated. The two remaining FS
    // races (bundle-demo-content / generate-registry / create-integration
    // racing for `.git/index.lock` via `git checkout HEAD --`, and
    // create-integration vs generate-registry on `showcase/integrations/`) were
    // fixed in this PR: the first via a cross-process lock in
    // `test-cleanup.ts`, the second by redirecting create-integration at a
    // per-suite tmpdir. With those in place, parallel file execution is
    // correct AND gives every file a fresh 60s birpc `onTaskUpdate` budget
    // (vitest #6129), eliminating the cumulative back-pressure that tripped
    // unit(20.x/22.x/24.x) on #4068/#4018/#4079 (158s → 19s locally,
    // 1061/1061 across 3 consecutive runs).
    fileParallelism: true,
    pool: "forks",
    // Exclude Playwright E2E tests — they use @playwright/test, not vitest.
    // Also exclude fixture *.spec.ts files under __tests__/fixtures/** —
    // these are inert data files consumed by validate-parity tests, not
    // real vitest suites, and vitest's default glob would otherwise pick
    // them up and fail with "No test suite found".
    exclude: ["__tests__/e2e/**", "__tests__/fixtures/**", "node_modules/**"],
  },
});
