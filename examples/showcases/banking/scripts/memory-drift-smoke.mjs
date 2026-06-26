#!/usr/bin/env node
/**
 * Real-LLM memory drift smoke — NON-GATING, run manually.
 *
 * WHY THIS EXISTS
 * The deterministic CI gate (tests/e2e/memory-learning.spec.ts) serves the agent's
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
 * live model still RECALLS-FIRST (the autonomous, load-bearing moment).
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
const KEY = process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00";
const USER_ID = process.env.CPKI_USER_ID ?? "jordan-beamson";
const TXN_ID = process.env.DRIFT_TXN_ID ?? "t-3";

const PROCEDURE = (code) =>
  `To approve an over-limit charge, open a policy exception with code ${code} ` +
  `against the charge and finalize it, then approve the transaction.`;
const SEED_CODE = "EXC-BOARD-APPROVED";

function log(ok, msg) {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
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
  if (!res.ok) throw new Error(`seed memory failed: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json().catch(() => ({}));
  return body;
}

async function runOverLimitTurn() {
  // Minimal AG-UI RunAgentInput. A fresh threadId guarantees no in-thread context —
  // the only way the agent can know the procedure is by calling recall_memory.
  const threadId = `drift-${Date.now()}`;
  const body = {
    threadId,
    runId: `${threadId}-run`,
    state: {},
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
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `run POST failed: HTTP ${res.status} ${await res.text().catch(() => "")}\n` +
        "hint: confirm the demo is running in Intelligence mode and the run endpoint " +
        "path/body shape matches this runtime version (see header NOTE).",
    );
  }
  // Stream the SSE response and scan for a recall_memory tool call. We stop as soon
  // as we see it (the agent then proceeds to HITL cards we can't answer headlessly).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (/recall_memory/.test(buf)) {
      reader.cancel().catch(() => {});
      return { recalled: true, sawSave: /save_memory/.test(buf) };
    }
  }
  return { recalled: false, sawSave: /save_memory/.test(buf) };
}

console.log(`memory drift smoke (REAL LLM) — demo ${DEMO_URL}, app-api ${APP_API_URL}, txn ${TXN_ID}\n`);

try {
  const seeded = await seedProcedureMemory();
  log(true, `seeded project/operational procedure memory (${seeded.absorbed ? "absorbed" : "created"})`);

  const { recalled } = await runOverLimitTurn();
  log(recalled, recalled
    ? "PASS: live model emitted recall_memory on a fresh-thread over-limit request"
    : "DRIFT: live model did NOT emit recall_memory — the recall-first prompt may have regressed");

  process.exit(recalled ? 0 : 1);
} catch (err) {
  log(false, `error: ${String(err).slice(0, 400)}`);
  process.exit(2);
}
