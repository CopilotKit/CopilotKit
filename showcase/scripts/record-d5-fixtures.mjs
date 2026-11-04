#!/usr/bin/env node
// Drive d5 probes for a fixed list of langgraph-python demos against
// aimock-in-record-mode and consolidate the per-call fixture files into
// one file per demo at showcase/aimock/d5-recorded/<slug>.json.
//
// Pre-conditions:
// - aimock running in --record mode (see showcase/docker-compose.record.yml)
// - aimock recorder writes `turnIndex` + `hasToolResult` on each fixture
//   (see "Aimock patch requirement" below)
// - showcase/.env has a real OPENAI_API_KEY (and ANTHROPIC if needed)
// - langgraph-python container running and pointing at aimock
//
// Aimock patch requirement:
//   The published `@copilotkit/aimock` (≤ 1.19.2) recorder writes ONLY
//   `match.userMessage` to recorded fixtures. That collapses every turn of
//   a multi-turn run onto the same match key — the first turn records, the
//   second turn matches the freshly-recorded in-memory fixture, never
//   proxies, and is silently lost. The matcher in the same package already
//   supports `turnIndex` and `hasToolResult` for exactly this kind of
//   disambiguation; only the recorder needs to write them.
//
//   Until that lands upstream, runs of this script require a small in-
//   place patch to the running aimock container's
//   `/app/dist/recorder.{js,cjs}` so each recorded fixture also carries:
//
//     match.turnIndex     = messages.filter(m => m.role === "assistant").length
//     match.hasToolResult = messages.some(m => m.role === "tool")
//
//   The patch is intentionally NOT applied automatically here — it is a
//   third-party node_modules edit and silent self-modification would be
//   surprising. The orchestrator probes the patched-recorder behavior
//   (probeRecorderPatch below) and aborts with a clear message if the
//   patch is missing. See the upstream proposal for the persistent fix
//   (`CopilotKit/aimock`, see PR description in this commit).
//
// What it does:
// 1. For each demo target in DEMOS, snapshot the timestamps of any files
//    already in d5-recorded/recorded/ (we only own NEW files).
// 2. Run `pnpm exec tsx src/cli.ts test langgraph-python:<demo> --d5`
//    inside showcase/harness — the probe drives the demo, hits aimock,
//    aimock proxies to real OpenAI and writes a fixture file per LLM
//    call to d5-recorded/recorded/.
// 3. After the probe finishes, collect every NEW fixture file (created
//    after the snapshot), merge their `fixtures` arrays into a single
//    `<slug>.json` under d5-recorded/, and delete the per-call files.
//
// Probe pass/fail is intentionally NOT enforced here. Many Bucket C
// demos fail their UI assertions even with real OpenAI; the LLM
// exchange is still recorded and that's all we need at this stage.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The journal-drain barrier lives in a shared module so the D4 proxy-capture
// flow (hand-run — see showcase/aimock/README.md) and this D5 recorder both
// gate on the exact same drain semantics.
import { waitForJournalDrain } from "./lib/journal-drain.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const RECORDED_DIR = path.join(
  REPO_ROOT,
  "showcase/aimock/d5-recorded/recorded",
);
const OUTPUT_DIR = path.join(REPO_ROOT, "showcase/aimock/d5-recorded");
const HARNESS_DIR = path.join(REPO_ROOT, "showcase/harness");

// Catalog feature IDs as listed in `showcase/integrations/langgraph-python/manifest.yaml`'s
// top-level `features` array. The harness target shape is `<slug>:<feature>`,
// so `feature` MUST be the manifest feature ID (not d5 script featureTypes nor
// per-pill sub-keys). Beautiful chat exercises five sub-pills under one
// feature, so a single `beautiful-chat` run records all five.
//
// `expectedTurns` is the number of upstream (record-mode `source:"proxy"`) LLM
// turns a single full-feature run drives. It is REQUIRED by the journal-drain
// barrier (`waitForJournalDrain` throws without it) and is what makes the
// barrier sound: quiescence alone can settle prematurely between turns while a
// slow final turn is still in flight (invisible in the journal until it lands),
// so the barrier must wait for a REAL turn count, not just for the journal to
// go quiet. See `lib/journal-drain.mjs`.
//
// The counts below are seeded from each feature's committed canonical fixture
// file (`aimock/d6/langgraph-python/<feature>.json`), which is the normalized
// consolidation of a prior real full-feature capture — the best static estimate
// available (`d5-recorded/` output is gitignored). They are a per-run turn count,
// NOT gospel: if a feature's flow changes, update the count. A count set too HIGH
// fails LOUD — the barrier never reaches it and times out, aborting the run
// (see the FATAL drain handling in `main`) rather than silently corrupting
// fixtures; a count set too LOW is the only unsafe direction, so err high and
// confirm against the live capture. `reasoning-custom` has no 1:1 canonical file
// (its d5 script also serves `reasoning-default`); its count is seeded from
// `reasoning.json`.
const DEMOS = [
  { feature: "tool-rendering-default-catchall", expectedTurns: 3 },
  { feature: "beautiful-chat", expectedTurns: 10 },
  { feature: "headless-complete", expectedTurns: 10 },
  { feature: "gen-ui-interrupt", expectedTurns: 4 },
  { feature: "gen-ui-tool-based", expectedTurns: 18 },
  { feature: "reasoning-custom", expectedTurns: 2 },
];

// Guard: every demo MUST declare a positive expectedTurns. A missing/zero count
// would reintroduce the unsound quiescence-only drain the barrier exists to
// prevent, so fail loudly at module load rather than silently.
for (const d of DEMOS) {
  if (!Number.isInteger(d.expectedTurns) || d.expectedTurns < 1) {
    throw new Error(
      `record-d5-fixtures: DEMOS entry "${d.feature}" must declare a positive integer ` +
        `expectedTurns (the real upstream turn count for its full-feature run), got ${d.expectedTurns}`,
    );
  }
}

async function listRecordedFiles() {
  try {
    const entries = await fs.readdir(RECORDED_DIR);
    return new Set(entries.filter((e) => e.endsWith(".json")));
  } catch (err) {
    if (err.code === "ENOENT") return new Set();
    throw err;
  }
}

async function execShell(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "pipe", shell: true });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (out += c.toString()));
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} ${args.join(" ")} → ${code}\n${out}`)),
    );
  });
}

async function probeRecorderPatch() {
  // Confirm the running aimock container's recorder writes turnIndex +
  // hasToolResult. Without the patch, multi-turn recording is broken
  // (every turn collides on `userMessage` alone). Failing here is
  // preferable to silently producing single-turn fixtures and then
  // having the replay miss tool-call follow-ups.
  let recorderJs;
  try {
    recorderJs = await execShell("docker", [
      "exec",
      "showcase-aimock",
      "cat",
      "/app/dist/recorder.js",
    ]);
  } catch (err) {
    throw new Error(
      `cannot read aimock recorder.js — is the showcase-aimock container running? (${err instanceof Error ? err.message : String(err)})`,
      { cause: err },
    );
  }
  const hasTurnIndex = /match\.turnIndex\s*=/.test(recorderJs);
  const hasToolResult = /match\.hasToolResult\s*=/.test(recorderJs);
  if (!hasTurnIndex || !hasToolResult) {
    throw new Error(
      [
        "aimock recorder is missing the multi-turn-disambiguation patch.",
        "  Expected `recorder.js` to write match.turnIndex AND match.hasToolResult",
        "  but found turnIndex=" +
          hasTurnIndex +
          ", hasToolResult=" +
          hasToolResult,
        "",
        "  Without the patch, recordings collapse to a single-turn fixture",
        "  and follow-up turns are silently lost. See the script's header",
        "  comment for the patch payload, or wait for the upstream fix in",
        "  @copilotkit/aimock to ship.",
      ].join("\n"),
    );
  }
}

async function restartAimock() {
  // Forces aimock to drop in-memory fixtures from previous recordings and
  // reload from disk. Without this, prompts already recorded in the current
  // session keep matching across demos and silently skip re-recording.
  await execShell("docker", ["restart", "showcase-aimock"]);
  // Poll the container's healthcheck — short loop, completes within ~10s.
  for (let i = 0; i < 30; i++) {
    try {
      const status = await execShell("docker", [
        "inspect",
        "--format='{{.State.Health.Status}}'",
        "showcase-aimock",
      ]);
      if (status.includes("healthy")) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("aimock did not become healthy after restart");
}

async function runProbe(demo) {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "src/cli.ts", "test", `langgraph-python:${demo}`, "--d5"],
      { cwd: HARNESS_DIR, shell: true, stdio: "inherit" },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function consolidateNewFiles(demo, beforeSet) {
  const after = await listRecordedFiles();
  const newFiles = [...after].filter((f) => !beforeSet.has(f));
  if (newFiles.length === 0) {
    console.log(`[record] ${demo}: no new fixtures recorded`);
    return { count: 0 };
  }
  // Read in timestamp order (filenames embed ISO timestamp).
  newFiles.sort();
  const fixtures = [];
  for (const name of newFiles) {
    const full = path.join(RECORDED_DIR, name);
    const raw = await fs.readFile(full, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.fixtures)) {
      for (const fx of parsed.fixtures) fixtures.push(fx);
    }
  }
  const outPath = path.join(OUTPUT_DIR, `${demo}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        _comment: `Recorded ${new Date().toISOString()} by record-d5-fixtures.mjs (langgraph-python d5:${demo})`,
        fixtures,
      },
      null,
      2,
    ),
  );
  // Clean up the per-call files we owned.
  for (const name of newFiles) {
    await fs.unlink(path.join(RECORDED_DIR, name));
  }
  console.log(
    `[record] ${demo}: wrote ${fixtures.length} fixtures → ${outPath}`,
  );
  return { count: fixtures.length };
}

/**
 * Ordering-critical seam: block on the journal-drain barrier, then (ONLY if it
 * drained) consolidate the captured fixtures.
 *
 * A drain TIMEOUT is FATAL. `waitForDrain` throws on timeout and we deliberately
 * do NOT catch it — the rejection propagates so the whole run aborts (main's
 * `.catch` exits non-zero) BEFORE any fixture consolidation or aimock restart.
 * The previous code caught this and logged a warning, then consolidated anyway;
 * that let a still-in-flight post-tool-result fixture land in the NEXT demo's
 * directory (or be lost) — a silent-failure hole. Never move fixtures on an
 * un-drained journal.
 *
 * Extracted (and exported) so this abort-before-consolidate ordering is unit
 * testable without spawning docker / a probe.
 *
 * @param {object} args
 * @param {string} args.feature
 * @param {() => Promise<{ completed: number }>} args.waitForDrain
 * @param {() => Promise<{ count: number }>} args.consolidate
 * @param {(msg: string) => void} [args.log]
 * @returns {Promise<{ count: number }>}
 */
export async function drainThenConsolidate({
  feature,
  waitForDrain,
  consolidate,
  log = console.log,
}) {
  const drain = await waitForDrain();
  log(`[record] ${feature}: journal drained (${drain.completed} turns)`);
  return consolidate();
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(RECORDED_DIR, { recursive: true });
  await probeRecorderPatch();
  const summary = [];
  for (const { feature, expectedTurns } of DEMOS) {
    console.log(`\n===== Recording ${feature} =====`);
    // Drop the demo's prior consolidated file (if any) so we don't double-
    // append on re-runs, then restart aimock so its in-memory fixture cache
    // doesn't carry that demo's prompts forward from a previous session.
    const outPath = path.join(OUTPUT_DIR, `${feature}.json`);
    try {
      await fs.unlink(outPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await restartAimock();

    const before = await listRecordedFiles();
    const code = await runProbe(feature);
    // The probe process can exit while aimock is still draining the final
    // post-tool-result turn. Block on the journal-drain barrier BEFORE moving
    // fixtures so a late fixture cannot land in the next demo's directory. A
    // timeout here is FATAL (drainThenConsolidate does NOT catch it): the run
    // aborts before consolidation rather than moving fixtures off an un-drained
    // journal.
    const result = await drainThenConsolidate({
      feature,
      waitForDrain: () => waitForJournalDrain({ expectedTurns }),
      consolidate: () => consolidateNewFiles(feature, before),
    });
    summary.push({
      demo: feature,
      probeExit: code,
      fixtureCount: result.count,
    });
  }
  console.log("\n===== Summary =====");
  for (const row of summary) {
    console.log(
      `  ${row.demo.padEnd(40)} probe=${row.probeExit === 0 ? "pass" : "fail"} fixtures=${row.fixtureCount}`,
    );
  }
}

// Only run the recording orchestration when invoked directly as a CLI. Guarding
// on the entry module keeps this file importable without triggering docker
// calls; the barrier helpers it uses live in ./lib/journal-drain.mjs and are
// unit-tested there.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
