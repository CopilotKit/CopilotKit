import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    exclude: ["node_modules", "dist", "test/integration/**", "test/e2e/**"],
    environment: "node",
    globals: false,
    // Several orchestrator integration tests boot a real Hono server,
    // chokidar watcher, scheduler, and PB client in beforeEach and tear
    // them down in afterEach. On macOS + CI runners the teardown can
    // spike well past the 10s default (chokidar.close on a deleted
    // tempdir + http.Server.close + scheduler settle) — visible as
    // cascading "Hook timed out in 10000ms" failures on `/health
    // wiring`, `OPS_TRIGGER_TOKEN`, and probe-unregister describe
    // blocks. The R21-a SIGHUP-reload test in particular deletes the
    // configDir mid-test and chokidar's watcher.close() on a vanished
    // path can hang for ~30s on macOS. 60s absorbs the variance
    // without masking real hangs (a stuck stop() blocks for minutes,
    // not seconds, so the ceiling still surfaces those cleanly).
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // NOTE: we intentionally do NOT exclude `src/**/index.ts` wholesale.
      // Barrel-only re-export files are counted as covered-by-proxy (they
      // transitively execute when any consumer imports a symbol), so they
      // don't hurt the threshold. Excluding them wholesale would silently
      // drop an index.ts that gains real logic from the coverage surface.
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        // Branches intentionally held AT lines/statements, not above:
        // the previous config set branches: 90 and the others to 85 —
        // inverted from the usual pattern (branches are hardest because
        // defensive guards for pb 5xx re-auth, S3 SDK dynamic import
        // failure, etc. are exercised integration-side, not unit-side).
        // A 90-branch floor caused spurious CI failures every time a
        // new guard landed without a paired unit test for its error arm.
        lines: 85,
        branches: 85,
        functions: 85,
        statements: 85,
        // Per-glob floors for the probe-driver + discovery-source registries.
        // These modules are closed-enum registry tables — every registered
        // driver/source is an operator-visible contract, and a regression
        // in the registry itself silently corrupts every probe tick. Hold
        // them at 95% line coverage so a new driver/source entering the
        // codebase without a paired unit test fails CI at the coverage
        // gate rather than shipping a probe path with no confidence.
        "src/probes/drivers/**": {
          lines: 95,
        },
        "src/probes/discovery/**": {
          lines: 95,
        },
      },
    },
  },
});
