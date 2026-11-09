// Shared Stryker config for the packages that run `nx run <pkg>:test:mutation`.
// See scripts/mutation/README.md for what the score means and how to read it.
import { availableParallelism } from "node:os";

/** Test code never gets mutants. */
const ALWAYS_SKIP = ["!src/**/__tests__/**", "!src/**/*.{test,spec}.{ts,tsx}"];

/**
 * @param {{ skip?: string[] }} [options] extra `mutate` globs to leave out
 *   (generated code, for example). Write them without the leading `!`.
 * @returns {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export function defineMutationConfig({ skip = [] } = {}) {
  return {
    packageManager: "pnpm",
    plugins: ["@stryker-mutator/vitest-runner"],
    testRunner: "vitest",
    vitest: { configFile: "vitest.mutation.config.mjs" },
    // Run only the tests that cover a mutant, and record which test killed
    // it. The per-test data is what lets us find tests that kill nothing.
    coverageAnalysis: "perTest",
    // Keep running after the first failing test so `killedBy` lists every
    // test that catches a mutant, not only the first one.
    disableBail: true,
    // Static mutants (module-level constants) rerun the whole suite each.
    // They are a small share of mutants and the main cost of a full run.
    ignoreStatic: true,
    mutate: ["src/**/*.{ts,tsx}", ...ALWAYS_SKIP, ...skip.map((g) => `!${g}`)],
    // Reruns only test the mutants whose code or covering tests changed.
    incremental: true,
    incrementalFile: "reports/mutation/stryker-incremental.json",
    concurrency: Number(
      process.env.STRYKER_CONCURRENCY ??
        Math.max(1, Math.floor(availableParallelism() / 2)),
    ),
    timeoutMS: 10_000,
    // Mutate the real files, not a copy in a sandbox folder. Some tests import
    // sibling packages by relative path (../../../../core/src/...), which
    // breaks one folder deeper. Stryker restores the files when it exits; if
    // it is killed, run `git checkout <package>/src`.
    inPlace: true,
    tempDirName: ".stryker-tmp",
    cleanTempDir: "always",
    reporters: ["progress", "clear-text", "html", "json"],
    // Only the score table. Every mutant and test would be 100k+ lines.
    clearTextReporter: {
      allowColor: false,
      reportMutants: false,
      reportTests: false,
      skipFull: true,
    },
    htmlReporter: { fileName: "reports/mutation/mutation.html" },
    jsonReporter: { fileName: "reports/mutation/mutation.json" },
    // No `break` threshold yet: this is a baseline, not a gate.
    thresholds: { high: 80, low: 60, break: null },
  };
}
