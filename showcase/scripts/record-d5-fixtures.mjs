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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const RECORDED_DIR = path.join(
  REPO_ROOT,
  "showcase/aimock/d5-recorded/recorded",
);
const OUTPUT_DIR = path.join(REPO_ROOT, "showcase/aimock/d5-recorded");
const HARNESS_DIR = path.join(REPO_ROOT, "showcase/harness");

// Host-side URL of the aimock request journal. docker-compose.local.yml maps
// the aimock container's port 4010 to localhost:4010, so the recorder driving
// this script reaches the journal here. Overridable for tests / non-default
// topologies via AIMOCK_URL.
const AIMOCK_BASE_URL = process.env.AIMOCK_URL ?? "http://localhost:4010";
const JOURNAL_URL = `${AIMOCK_BASE_URL.replace(/\/+$/, "")}/__aimock/journal`;

// Catalog feature IDs as listed in `showcase/integrations/langgraph-python/manifest.yaml`'s
// top-level `features` array. The harness target shape is `<slug>:<feature>`,
// so these MUST be the manifest feature IDs (not d5 script featureTypes nor
// per-pill sub-keys). Beautiful chat exercises five sub-pills under one
// feature, so a single `beautiful-chat` run records all five.
const DEMOS = [
  "tool-rendering-default-catchall",
  "beautiful-chat",
  "headless-complete",
  "gen-ui-interrupt",
  "gen-ui-tool-based",
  "reasoning-custom",
];

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True when a journal entry represents a COMPLETED upstream turn — i.e. aimock
 * has fully served the request and appended the entry (so any fixture it
 * produced is already written to disk).
 *
 * Two completion shapes exist, both observed live on this aimock build:
 *   - RECORD mode: no fixture matched, aimock proxied to the real provider and
 *     wrote a fixture. The entry carries `response.source === "proxy"`.
 *   - REPLAY: a fixture served the request. `response.fixture` is populated but
 *     `response.source` is UNSET (aimock does not stamp source:"fixture" on a
 *     normal replay), so we MUST gate on `status === 200 && fixture != null`
 *     and never on `source === "fixture"`.
 *
 * Both are 200s; anything else (in-flight has no entry yet, errors, chaos
 * fallbacks) is not a settled upstream turn.
 */
function isCompletedTurn(entry) {
  const r = entry?.response;
  if (!r || r.status !== 200) return false;
  return r.source === "proxy" || r.fixture != null;
}

/**
 * Count the completed upstream turns in a journal entries array. Tolerant of
 * non-array / malformed input (returns 0) so a transient bad journal read
 * cannot throw out of the drain loop.
 */
export function countCompletedTurns(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter(isCompletedTurn).length;
}

/**
 * Journal-drain barrier. Poll aimock's request journal until the run has fully
 * drained before the caller moves fixtures or restarts aimock.
 *
 * Why this exists: a probe marks a cell satisfied as soon as the tool card
 * meets the assertion, but the POST-tool-result LLM turn can still be draining
 * (aimock still proxying upstream + writing the fixture) after the probe
 * process exits. If we move fixtures / restart aimock at that instant, the late
 * fixture lands in the NEXT run's directory — observed as a run-3 follow-up
 * landing under run 4, and a run-4 EMPTY initial-weather fixture landing under
 * run 5 (weather then went red on replay).
 *
 * "Drained" here = the completed-turn count has reached `expectedTurns` AND has
 * stopped growing for `quiesceMs` (nothing else is in flight). Because the
 * journal only appends an entry once a turn is fully served, a turn still
 * draining is simply absent from the count; requiring the count to hold steady
 * for a quiescence window is how we know no further turn is about to land.
 *
 * `expectedTurns` is a floor (e.g. the built-in-agent D4 weather flow expects 3:
 * greeting, tool-call turn, post-tool-result turn); pass 0 to wait purely for
 * quiescence when the exact turn count for a demo is not known ahead of time.
 *
 * Rejects with a clear error if the journal never drains within `timeoutMs`.
 */
export async function waitForJournalDrain({
  expectedTurns = 0,
  journalUrl = JOURNAL_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120000,
  pollIntervalMs = 500,
  quiesceMs = 2000,
} = {}) {
  if (!Number.isInteger(expectedTurns) || expectedTurns < 0) {
    throw new Error(
      `waitForJournalDrain: expectedTurns must be a non-negative integer, got ${expectedTurns}`,
    );
  }
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let lastChangeAt = Date.now();
  let observed = 0;
  for (;;) {
    let entries = [];
    try {
      const res = await fetchImpl(journalUrl);
      if (!res.ok)
        throw new Error(`journal endpoint returned HTTP ${res.status}`);
      const body = await res.json();
      // aimock may return the entries array directly or wrapped in { entries }.
      entries = Array.isArray(body)
        ? body
        : Array.isArray(body?.entries)
          ? body.entries
          : [];
    } catch {
      // Transient read failure (e.g. aimock mid-restart) — treat as not-yet-
      // drained and keep polling until the timeout.
      entries = [];
    }
    observed = countCompletedTurns(entries);
    const now = Date.now();
    if (observed !== lastCount) {
      lastCount = observed;
      lastChangeAt = now;
    }
    const quiesced = now - lastChangeAt >= quiesceMs;
    if (observed >= expectedTurns && quiesced) {
      return { completed: observed };
    }
    if (now >= deadline) {
      throw new Error(
        `waitForJournalDrain: journal did not drain within ${timeoutMs}ms — ` +
          `expected >= ${expectedTurns} completed upstream turns (quiescent for ` +
          `${quiesceMs}ms) but observed ${observed}. A late post-tool-result turn ` +
          `may still be in flight; moving fixtures now risks landing it in the ` +
          `next run's directory.`,
      );
    }
    await sleep(pollIntervalMs);
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

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(RECORDED_DIR, { recursive: true });
  await probeRecorderPatch();
  const summary = [];
  for (const demo of DEMOS) {
    console.log(`\n===== Recording ${demo} =====`);
    // Drop the demo's prior consolidated file (if any) so we don't double-
    // append on re-runs, then restart aimock so its in-memory fixture cache
    // doesn't carry that demo's prompts forward from a previous session.
    const outPath = path.join(OUTPUT_DIR, `${demo}.json`);
    try {
      await fs.unlink(outPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await restartAimock();

    const before = await listRecordedFiles();
    const code = await runProbe(demo);
    // The probe process can exit while aimock is still draining the final
    // post-tool-result turn. Block on the journal-drain barrier BEFORE moving
    // fixtures so a late fixture cannot land in the next demo's directory.
    try {
      const drain = await waitForJournalDrain({ expectedTurns: 0 });
      console.log(
        `[record] ${demo}: journal drained (${drain.completed} turns)`,
      );
    } catch (err) {
      console.warn(
        `[record] ${demo}: journal-drain barrier did not settle — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const result = await consolidateNewFiles(demo, before);
    summary.push({ demo, probeExit: code, fixtureCount: result.count });
  }
  console.log("\n===== Summary =====");
  for (const row of summary) {
    console.log(
      `  ${row.demo.padEnd(40)} probe=${row.probeExit === 0 ? "pass" : "fail"} fixtures=${row.fixtureCount}`,
    );
  }
}

// Only run the recording orchestration when invoked directly as a CLI. Guarding
// on the entry module keeps the exported helpers (waitForJournalDrain,
// countCompletedTurns) importable from tests without triggering docker calls.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
