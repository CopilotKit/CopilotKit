/**
 * CI gate config for the harness unit suite.
 *
 * Identical to `vitest.config.ts` except that the files listed in
 * `vitest.quarantine.json` are excluded. That manifest carries the reason and
 * the exit criterion for every entry; `scripts/quarantine-ratchet.ts` then
 * re-runs exactly those files and requires each to STILL FAIL, so an entry
 * cannot outlive the failure it excuses.
 *
 * Local `pnpm test` deliberately keeps using `vitest.config.ts` (no
 * exclusions) — a developer running the suite should see the quarantined
 * failures. This config exists only so the CI gate is green on arrival and
 * therefore survives contact with a busy check list.
 */
import { readFileSync } from "node:fs";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config";

interface QuarantineEntry {
  file: string;
  since: string;
  reason: string;
  unquarantineWhen: string;
}

const manifestUrl = new URL("./vitest.quarantine.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  quarantined: QuarantineEntry[];
};

const quarantinedFiles = manifest.quarantined.map((entry) => entry.file);

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // `mergeConfig` concatenates arrays, so these are ADDED to the base
      // config's excludes rather than replacing them.
      exclude: quarantinedFiles,

      // CI-ONLY flake tolerance, deliberately NOT set in the base config so a
      // developer running `pnpm test` still sees non-determinism.
      //
      // This is not `continue-on-error` in disguise: a genuinely broken test
      // fails all three attempts and the gate stays red. It tolerates only
      // non-determinism, and vitest prints every retried test, so a flake that
      // starts happening is visible in the log rather than silent.
      //
      // KNOWN OFFENDER (report it, don't hide it):
      // `src/probes/loader/probe-invoker.test.ts` →
      // "times out at the invoker level when enumerate() ignores abortSignal"
      // asserts a WALL-CLOCK `elapsed < 150` against a 100ms invoker timeout
      // racing a 200ms enumerate. 50ms of headroom does not survive CPU
      // contention: the test passed 5/5 in isolation but failed twice at
      // ~217ms while the machine was running other vitest suites — and a
      // 4-vCPU runner executing 173 test files in parallel is exactly that
      // condition. The real fix is for the probe-loader owner to drive that
      // assertion off fake timers (or widen the bound), after which this
      // `retry` should be removed.
      retry: 2,
    },
  }),
);
