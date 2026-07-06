#!/usr/bin/env node
/**
 * Real-LLM memory drift smoke — NON-GATING, run manually.
 *
 * WHY THIS EXISTS
 * The deterministic CI gate (e2e/memory-learning.spec.ts) serves the agent's
 * LLM from aimock fixtures, so it proves the WIRING (prompt -> tool call -> memory
 * backend -> cross-thread recall -> unlock) but is BLIND to behavioral drift: a
 * fixture replays a fixed decision, so if a prompt edit makes the real model stop
 * calling its memory tools, the aimock test keeps passing. This script closes that
 * gap with a REAL OpenAI call.
 *
 * WHAT IT CHECKS (headless half)
 * It seeds the over-limit procedure as a project/operational memory via REST, then
 * drives a FRESH-THREAD over-limit approval request through the live runtime and
 * asserts the run's event stream contains a `recall_memory` tool call — i.e. the
 * live model still RECALLS-FIRST (the autonomous, load-bearing moment). It also
 * asserts that NO `save_memory` fires on that over-limit request turn (rule 9:
 * GENERAL MEMORY must defer during a procedure). The mid-demonstration turns are
 * HITL/headless-unreachable, so that coverage lives in the aimock e2e + the manual
 * walkthrough.
 *
 * WHAT IT DOES NOT CHECK
 * The SAVE half (the agent emitting `save_memory` after the teach arc) is gated
 * behind the human-in-the-loop teach cards (offerWorkflowRecording ->
 * awaitDashboardDemonstration -> saveLearnedWorkflow) and cannot be driven
 * headlessly. Verify the save path via the manual UI walkthrough (README step 3)
 * and the aimock E2E.
 *
 * REQUIREMENTS
 *   - The memory-enabled stack is up (docker compose; see README) and reachable.
 *   - The demo dev server is running in Intelligence mode (the three INTELLIGENCE_*
 *     env vars set) with a real OPENAI_API_KEY.
 *
 * READINESS GATE
 *   The Intelligence sl-mcp worker can throw an UnhandledPromiseRejection during boot
 *   and briefly drop /mcp connections even after `docker compose up --wait` reports the
 *   container healthy. This smoke first polls `POST /mcp initialize` until it returns 200,
 *   so it only runs once memory is actually serving — a booting/down backend fails fast
 *   with a clear message instead of masquerading as recall drift.
 *
 * USAGE
 *   node scripts/memory-drift-smoke.mjs
 * ENV (optional)
 *   DEMO_URL          default http://localhost:3000
 *   APP_API_URL       default http://localhost:7050
 *   INTELLIGENCE_API_KEY  default cpk_sPRVSEED_seed0privat0longtoken00
 *   CPKI_USER_ID      default jordan-beamson
 *   DRIFT_TXN_ID      default t-3  (an over-limit pending seed txn)
 *
 * NOTE: the run is posted to the AG-UI run endpoint
 * `${DEMO_URL}/api/copilotkit/agent/default/run` with a minimal RunAgentInput. If a
 * future runtime version changes that path or body shape, that POST is the one spot
 * to adjust — the seed/recall REST calls and the stream scan are stable.
 */

const DEMO_URL = process.env.DEMO_URL ?? "http://localhost:3000";
const APP_API_URL = process.env.APP_API_URL ?? "http://localhost:7050";
const KEY =
  process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00";
const USER_ID = process.env.CPKI_USER_ID ?? "jordan-beamson";
const TXN_ID = process.env.DRIFT_TXN_ID ?? "t-3";

const PROCEDURE = (code) =>
  `To approve an over-limit charge, open a policy exception with code ${code} ` +
  `against the charge and finalize it, then approve the transaction.`;
const SEED_CODE = "EXC-BOARD-APPROVED";

function log(ok, msg) {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll POST /mcp `initialize` until the sl-mcp worker answers 200 and the SSE body
// completes without a reset. Guards against the Intelligence backend's boot window,
// where the worker throws an UnhandledPromiseRejection and drops /mcp connections even
// though the container reports healthy — running against that window makes the agent
// lose recall_memory mid-run and looks like drift. Fails fast so a booting backend
// never masquerades as a prompt regression.
async function waitForMcpReady({ retries = 30, delayMs = 1000 } = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "smoke-preflight", version: "1" },
    },
  });
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${APP_API_URL}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "X-Cpki-User-Id": USER_ID,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body,
      });
      if (res.ok) {
        await res.text(); // reading the body catches a mid-stream reset
        return;
      }
    } catch {
      // connection refused / reset during boot — keep polling
    }
    await sleep(delayMs);
  }
  throw new Error(
    `MCP not ready after ${retries * delayMs}ms — the Intelligence sl-mcp worker never ` +
      `stabilized at POST ${APP_API_URL}/mcp (initialize). Bring up / restart the stack ` +
      `(docker compose up -d --wait) and confirm 'docker logs' shows no boot-time ` +
      `UnhandledPromiseRejection, then retry.`,
  );
}

// Confirm the demo dev server (pnpm dev) is up at DEMO_URL. The /mcp gate only covers
// the backend (:7050); the over-limit run below hits the app (:3000). Any HTTP response
// means it is serving; only a connection error means it is down.
async function waitForDemoServer({ retries = 20, delayMs = 1000 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(DEMO_URL, { method: "GET" });
      return;
    } catch {
      // connection refused — dev server not up yet
    }
    await sleep(delayMs);
  }
  throw new Error(
    `Demo dev server not reachable at ${DEMO_URL} — start it with 'pnpm dev' ` +
      `(Intelligence mode: the three INTELLIGENCE_* env vars + a real OPENAI_API_KEY), then retry.`,
  );
}

async function seedProcedureMemory() {
  const res = await fetch(`${APP_API_URL}/api/memories`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "X-Cpki-User-Id": USER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: PROCEDURE(SEED_CODE),
      scope: "project",
      kind: "operational",
    }),
  });
  if (!res.ok)
    throw new Error(
      `seed memory failed: HTTP ${res.status} ${await res.text()}`,
    );
  const body = await res.json().catch(() => ({}));
  return body;
}

async function runOverLimitTurn() {
  // Minimal AG-UI RunAgentInput. A fresh UUID threadId guarantees no in-thread context
  // (the only way the agent can know the procedure is by calling recall_memory) and
  // satisfies the Intelligence backend's UUID validation (a custom "drift-..." id 400s).
  const threadId = crypto.randomUUID();
  const body = {
    threadId,
    runId: crypto.randomUUID(),
    state: {},
    // Alex -> jordan-beamson (the id we seed the procedure under). Makes the
    // smoke identity-self-sufficient so it passes against the unpinned live demo.
    properties: { userId: "9g5h2j1k4l", userRole: "Admin" },
    messages: [
      {
        id: "m1",
        role: "user",
        content: `Please approve the over-limit charge ${TXN_ID}.`,
      },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
  };
  const res = await fetch(`${DEMO_URL}/api/copilotkit/agent/default/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `run POST failed: HTTP ${res.status} ${await res.text().catch(() => "")}\n` +
        "hint: confirm the demo is running in Intelligence mode and the run endpoint " +
        "path/body shape matches this runtime version (see header NOTE).",
    );
  }
  // Drain the FULL turn's SSE (until the run ends or the deadline) before scanning.
  // We must not early-return on the first recall_memory frame: because RECALL FIRST
  // makes recall stream before anything else, a spurious general save_memory (rule 9
  // leak) streams AFTER it — cancelling the reader on recall would cut that frame off
  // and make the negative-save assertion a false negative. The turn ends after the
  // agent emits its tool calls (the HITL cards are answered on the NEXT turn, which
  // we never send), so draining terminates naturally; the deadline is a backstop.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return {
    recalled: /recall_memory/.test(buf),
    sawSave: /save_memory/.test(buf),
  };
}

console.log(
  `memory drift smoke (REAL LLM) — demo ${DEMO_URL}, app-api ${APP_API_URL}, txn ${TXN_ID}\n`,
);

try {
  await waitForMcpReady();
  log(true, "preflight: /mcp initialize is serving (memory tools ready)");
  await waitForDemoServer();
  log(true, `preflight: demo dev server reachable at ${DEMO_URL}`);

  const seeded = await seedProcedureMemory();
  log(
    true,
    `seeded project/operational procedure memory (${seeded.absorbed ? "absorbed" : "created"})`,
  );

  const { recalled, sawSave } = await runOverLimitTurn();
  log(
    recalled,
    recalled
      ? "PASS: live model emitted recall_memory on a fresh-thread over-limit request"
      : "DRIFT: live model did NOT emit recall_memory — the recall-first prompt may have regressed",
  );
  // Rule 9 (DEFER DURING PROCEDURES): the over-limit request turn must NOT emit a
  // general save. A spurious save_memory here means the GENERAL MEMORY block is
  // firing inside the teach flow.
  log(
    !sawSave,
    sawSave
      ? "DRIFT: a save_memory fired on the over-limit request turn — GENERAL MEMORY leaked into the procedure (rule 9)"
      : "PASS: no spurious save_memory on the over-limit request turn",
  );
  process.exit(recalled && !sawSave ? 0 : 1);
} catch (err) {
  log(false, `error: ${String(err).slice(0, 400)}`);
  process.exit(2);
}
