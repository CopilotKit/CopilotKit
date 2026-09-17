/**
 * CI gate config for the shell-docs unit suite.
 *
 * Identical to `vitest.config.ts` except that the files listed in
 * `vitest.quarantine.json` are excluded. That manifest carries the reason and
 * the exit criterion for every entry; `scripts/quarantine-ratchet.ts` then
 * re-runs exactly those files and requires each to STILL FAIL, so an entry
 * cannot outlive the failure it excuses.
 *
 * Local `npm test` deliberately keeps using `vitest.config.ts` (no
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
    },
  }),
);
