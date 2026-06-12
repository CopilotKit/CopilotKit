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
import { fileURLToPath } from "node:url";

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

(async () => {
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
    const result = await consolidateNewFiles(demo, before);
    summary.push({ demo, probeExit: code, fixtureCount: result.count });
  }
  console.log("\n===== Summary =====");
  for (const row of summary) {
    console.log(
      `  ${row.demo.padEnd(40)} probe=${row.probeExit === 0 ? "pass" : "fail"} fixtures=${row.fixtureCount}`,
    );
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
