#!/usr/bin/env node
/**
 * Self-learning smoke test: record → (distill) → recall.
 *
 * Proves the demo's recording seam end-to-end against a running
 * Intelligence backend (see README "Self-learning backend"):
 *
 *   1. record  — POSTs four teaching actions through the demo BFF
 *                (`/api/copilotkit/annotate`), exactly like the in-app
 *                call sites do. The runtime resolves the user via
 *                `identifyUser` and forwards to the platform's
 *                `PUT /connector/annotate/:clientEventId`.
 *   2. distill — (optional) runs one sl-worker sweep so the writer
 *                agent turns the recorded actions into knowledge.
 *                Enabled when INTELLIGENCE_REPO points at a checkout
 *                of the Intelligence repo with a built sl-worker.
 *   3. recall  — calls the platform's `/mcp` endpoint
 *                (`copilotkit_knowledge_base_shell`) and asserts the
 *                distilled vendor policy is readable back.
 *
 * Prerequisites: the demo dev server running in Intelligence mode
 * (INTELLIGENCE_* env set — see README) and the Intelligence app-api
 * reachable. Defaults match the README's local runbook.
 *
 * Usage:
 *   node scripts/self-learning-smoke.mjs
 *   INTELLIGENCE_REPO=~/Projects/intelligence node scripts/self-learning-smoke.mjs
 *
 * Env (all optional):
 *   DEMO_URL              default http://localhost:3000
 *   INTELLIGENCE_API_URL  default http://localhost:7050
 *   INTELLIGENCE_API_KEY  default read from .env next to this demo
 *   INTELLIGENCE_USER_ID  default morgan-fluxx (must be an org member)
 *   INTELLIGENCE_REPO     path to the Intelligence repo; enables distill
 *   SMOKE_RECALL_PATTERN  default "pre-cleared"
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseDotenv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const demoEnv = parseDotenv(join(demoRoot, ".env"));

const DEMO_URL = process.env.DEMO_URL ?? "http://localhost:3000";
const API_URL =
  process.env.INTELLIGENCE_API_URL ??
  demoEnv.INTELLIGENCE_API_URL ??
  "http://localhost:7050";
const API_KEY =
  process.env.INTELLIGENCE_API_KEY ?? demoEnv.INTELLIGENCE_API_KEY ?? "";
const USER_ID =
  process.env.INTELLIGENCE_USER_ID ??
  demoEnv.INTELLIGENCE_USER_ID ??
  "morgan-fluxx";
const INTELLIGENCE_REPO = process.env.INTELLIGENCE_REPO ?? "";
const RECALL_PATTERN = process.env.SMOKE_RECALL_PATTERN ?? "pre-cleared";

const runId = `smoke-${Date.now().toString(36)}`;
const results = [];

function report(phase, ok, detail) {
  results.push({ phase, ok });
  console.log(`${ok ? "✓" : "✗"} ${phase}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------- record

const TEACHING_ACTIONS = [
  {
    title: "Approved wire transfer to Helvetica Logistics ($18,200)",
    description:
      "Officer approved without a compliance hold: Helvetica Logistics is a " +
      "board pre-cleared vendor (memo FIN-2026-014) and the amount is under " +
      "the $50,000 threshold, so no hold is required.",
    data: {
      previous: {
        status: "pending",
        amount: 18200,
        vendor: "Helvetica Logistics",
      },
      next: { status: "approved", hold: false },
    },
  },
  {
    title: "Approved wire transfer to Meridian Supply Co ($9,750)",
    description:
      "Same policy basis: Meridian Supply Co appears on the board's " +
      "pre-cleared vendor list (memo FIN-2026-014); wires under $50,000 to " +
      "pre-cleared vendors are exempt from compliance holds.",
    data: {
      previous: {
        status: "pending",
        amount: 9750,
        vendor: "Meridian Supply Co",
      },
      next: { status: "approved", hold: false },
    },
  },
  {
    title: "Held wire transfer to Helvetica Logistics ($62,400)",
    description:
      "Counterexample: even for pre-cleared vendors, wires of $50,000 and " +
      "above still require a compliance hold plus dual approval, so the " +
      "officer placed this $62,400 wire on hold.",
    data: {
      previous: {
        status: "pending",
        amount: 62400,
        vendor: "Helvetica Logistics",
      },
      next: { status: "held", hold: true, reason: "amount >= $50,000" },
    },
  },
  {
    title: "Officer note: pre-cleared vendor wire policy",
    description:
      "Policy summary for the record: vendors pre-cleared by the board " +
      "(memo FIN-2026-014) are exempt from compliance holds for wires under " +
      "$50,000. At or above $50,000 a compliance hold and dual approval are " +
      "still required, regardless of pre-clearance.",
    data: { previous: null, next: null },
  },
];

async function record() {
  let ok = true;
  for (const [i, action] of TEACHING_ACTIONS.entries()) {
    const response = await fetch(`${DEMO_URL}/api/copilotkit/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "user_action",
        threadId: runId,
        // The platform validates clientEventId as a UUID (the in-app hook
        // auto-generates one per call for end-to-end idempotency).
        clientEventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: action,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      ok = false;
      report(
        `record ${i + 1}/4`,
        false,
        `HTTP ${response.status}: ${body.slice(0, 200)}`,
      );
    } else {
      report(
        `record ${i + 1}/4`,
        true,
        `HTTP ${response.status} ${body.slice(0, 80)}`,
      );
    }
  }
  return ok;
}

// --------------------------------------------------------------- distill

function distill() {
  if (!INTELLIGENCE_REPO) {
    console.log(
      "- distill — skipped (set INTELLIGENCE_REPO to a checkout of the " +
        "Intelligence repo to run an sl-worker sweep)",
    );
    return true;
  }
  const worker = join(INTELLIGENCE_REPO, "dist/apps/sl-worker/main.mjs");
  if (!existsSync(worker)) {
    report(
      "distill",
      false,
      `${worker} not found — build it first: pnpm nx build @cpki/sl-worker-app`,
    );
    return false;
  }
  // The worker reads its config from env; mirror `source .env` in the repo.
  const repoEnv = parseDotenv(join(INTELLIGENCE_REPO, ".env"));
  const sweep = spawnSync("node", [worker], {
    cwd: INTELLIGENCE_REPO,
    env: { ...process.env, ...repoEnv },
    encoding: "utf8",
    timeout: 300_000,
  });
  const out = `${sweep.stdout ?? ""}${sweep.stderr ?? ""}`;
  const editCount = out.match(/editCount[":\s]+(\d+)/)?.[1];
  if (sweep.status !== 0) {
    report(
      "distill",
      false,
      `sl-worker exited ${sweep.status}\n${out.slice(-600)}`,
    );
    return false;
  }
  report(
    "distill",
    true,
    `sweep completed${editCount !== undefined ? ` (editCount=${editCount})` : ""}`,
  );
  return true;
}

// ---------------------------------------------------------------- recall

async function mcpShell(command) {
  const response = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "x-cpki-user-id": USER_ID,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "copilotkit_knowledge_base_shell",
        arguments: { command },
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  // Stateless StreamableHTTP answers either as JSON or as an SSE stream.
  const payloads = text.startsWith("{")
    ? [text]
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
  for (const payload of payloads) {
    const message = JSON.parse(payload);
    if (message.id === 1) {
      if (message.error)
        throw new Error(`MCP error: ${JSON.stringify(message.error)}`);
      const texts = (message.result?.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text);
      return {
        output: texts.slice(0, -1).join("\n"),
        status: texts.at(-1) ?? "",
        isError: Boolean(message.result?.isError),
      };
    }
  }
  throw new Error(`No tool result in response: ${text.slice(0, 300)}`);
}

async function recall() {
  if (!API_KEY) {
    report(
      "recall",
      false,
      "INTELLIGENCE_API_KEY is not set (env or demo .env)",
    );
    return false;
  }
  try {
    const listing = await mcpShell("ls -R /project");
    console.log(`  knowledge tree:\n${listing.output.replace(/^/gm, "    ")}`);
    const match = await mcpShell(`grep -ri "${RECALL_PATTERN}" /project`);
    const found = !match.isError && match.output.trim().length > 0;
    if (found) {
      console.log(
        `  matches:\n${match.output.replace(/^/gm, "    ").slice(0, 1200)}`,
      );
    }
    report(
      "recall",
      found,
      found
        ? `knowledge contains "${RECALL_PATTERN}"`
        : `no knowledge matching "${RECALL_PATTERN}" — if this is a fresh ` +
            "database, run with INTELLIGENCE_REPO set so the distill phase executes",
    );
    return found;
  } catch (error) {
    report("recall", false, String(error).slice(0, 300));
    return false;
  }
}

// ------------------------------------------------------------------ main

console.log(`self-learning smoke — thread ${runId}`);
console.log(`  demo: ${DEMO_URL}`);
console.log(`  api:  ${API_URL} (user ${USER_ID})\n`);

const recordOk = await record();
const distillOk = distill();
const recallOk = await recall();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} checks passed`,
);
if (!recordOk) {
  console.log(
    "hint: record failures usually mean the demo is running in pure OSS mode " +
      "(422 — set the INTELLIGENCE_* env vars) or the backend lacks the " +
      "/connector/annotate route (404 — needs Intelligence ≥ mme/learn-from-user-activity).",
  );
}
process.exit(recordOk && distillOk && recallOk ? 0 : 1);
