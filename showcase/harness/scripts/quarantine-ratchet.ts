#!/usr/bin/env tsx
/**
 * Quarantine ratchet for the harness unit suite.
 *
 * `vitest.ci.config.ts` excludes the files listed in `vitest.quarantine.json`
 * so the CI gate is green on arrival. That exclusion is only defensible if the
 * list cannot rot, so this script runs each quarantined file in its own vitest
 * invocation and asserts it STILL FAILS.
 *
 *   quarantined file fails  → expected; nothing to do.
 *   quarantined file PASSES → ratchet FAILS. Somebody fixed it (or the failure
 *                             was environmental all along) and the entry must
 *                             be deleted from the manifest so the file rejoins
 *                             the real gate.
 *   quarantined file missing → ratchet FAILS. A deleted/renamed test must not
 *                             leave a stale excuse behind.
 *
 * There is deliberately no `continue-on-error` / `|| true` anywhere in this
 * path: both the gate and the ratchet are hard failures.
 *
 * Run via nx: `nx run @copilotkit/showcase-harness:test:quarantine-ratchet`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface QuarantineEntry {
  file: string;
  since: string;
  reason: string;
  unquarantineWhen: string;
}

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(harnessRoot, "vitest.quarantine.json");

// Resolve vitest's own CLI entry rather than trusting `vitest` to be on PATH:
// the ratchet must behave identically under nx, pnpm, and a bare `tsx` call.
const require = createRequire(import.meta.url);
const vitestCli = require.resolve("vitest/vitest.mjs");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  quarantined?: unknown;
};

if (!Array.isArray(manifest.quarantined)) {
  console.error(
    `::error::${manifestPath}: expected a "quarantined" array. Refusing to run — a malformed manifest must not silently disable the ratchet.`,
  );
  process.exit(2);
}

const entries = manifest.quarantined as QuarantineEntry[];

// A schema check, not decoration: an entry without a reason and an exit
// criterion is an unexplained hole, and an entry without `since` makes it
// impossible to see how long a failure has been excused.
const REQUIRED_FIELDS = [
  "file",
  "since",
  "reason",
  "unquarantineWhen",
] as const;

const schemaProblems: string[] = [];
for (const [index, entry] of entries.entries()) {
  for (const field of REQUIRED_FIELDS) {
    const value = entry?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      schemaProblems.push(
        `quarantined[${index}]: missing or empty "${field}" (every entry needs a file, a date, a reason, and an exit criterion)`,
      );
    }
  }
  if (
    typeof entry?.since === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.since)
  ) {
    schemaProblems.push(
      `quarantined[${index}]: "since" must be an ISO date (YYYY-MM-DD), got "${entry.since}"`,
    );
  }
}

if (schemaProblems.length > 0) {
  for (const problem of schemaProblems) {
    console.error(`::error::${manifestPath}: ${problem}`);
  }
  process.exit(2);
}

if (entries.length === 0) {
  console.log(
    "Quarantine manifest is empty — every harness unit test is inside the CI gate. Nothing to ratchet.",
  );
  process.exit(0);
}

console.log(
  `Ratcheting ${entries.length} quarantined file(s). Each MUST still fail; a passing one means the entry is stale.\n`,
);

const stale: string[] = [];
const missing: string[] = [];

for (const entry of entries) {
  const absolute = resolve(harnessRoot, entry.file);

  if (!existsSync(absolute)) {
    console.error(`MISSING  ${entry.file} — quarantined but not on disk`);
    missing.push(entry.file);
    continue;
  }

  // Run the file through the BASE config (not the CI config, which excludes
  // it). `--reporter=dot` keeps the log short; we only care about exit status.
  const result = spawnSync(
    process.execPath,
    [
      vitestCli,
      "run",
      "--config",
      "vitest.config.ts",
      "--reporter=dot",
      entry.file,
    ],
    {
      cwd: harnessRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: process.env,
      shell: false,
    },
  );

  if (result.error) {
    console.error(
      `::error::could not launch vitest for ${entry.file}: ${result.error.message}`,
    );
    process.exit(2);
  }

  // vitest treats a positional as a path SUBSTRING filter, so verify it
  // selected exactly one file. If a filter ever widened, a red sibling could
  // mask a quarantined file that has actually started passing.
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const selected = output.match(/Test Files\s+.*?\((\d+)\)/);
  if (!selected) {
    console.error(
      `::error::could not parse a "Test Files" summary from vitest for ${entry.file}. Refusing to treat an unparseable run as a justified quarantine.`,
    );
    console.error(output);
    process.exit(2);
  }
  if (selected[1] !== "1") {
    console.error(
      `::error::the quarantine entry "${entry.file}" selected ${selected[1]} test files, not 1. Make the entry match exactly one file — a broad filter can hide a quarantined test that now passes behind a failing sibling.`,
    );
    process.exit(2);
  }

  if (result.status === 0) {
    console.error(
      `STALE    ${entry.file} — quarantined since ${entry.since} but the file now PASSES`,
    );
    stale.push(entry.file);
  } else {
    console.log(
      `still red ${entry.file} (exit ${result.status}) — quarantine since ${entry.since} still justified`,
    );
  }
}

if (stale.length === 0 && missing.length === 0) {
  console.log(
    `\nQuarantine ratchet OK: all ${entries.length} quarantined file(s) still fail.`,
  );
  process.exit(0);
}

console.error("");
for (const file of stale) {
  const entry = entries.find((candidate) => candidate.file === file);
  console.error(
    `::error file=showcase/harness/${file}::This test now PASSES but is still quarantined in showcase/harness/vitest.quarantine.json. Delete its entry so the file rejoins the CI gate. Recorded exit criterion was: ${entry?.unquarantineWhen}`,
  );
}
for (const file of missing) {
  console.error(
    `::error::showcase/harness/vitest.quarantine.json quarantines "${file}", which does not exist. If the test was deleted or renamed, remove or update the entry — a stale exclusion silently shrinks the gate.`,
  );
}
process.exit(1);
