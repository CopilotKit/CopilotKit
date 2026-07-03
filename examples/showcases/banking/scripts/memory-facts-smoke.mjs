#!/usr/bin/env node
/**
 * Real-LLM general-memory smoke — NON-GATING, run manually.
 * Mirrors memory-drift-smoke.mjs. Asserts the GENERAL MEMORY prompt behavior:
 *   SAVE      — a personal fact triggers save_memory(kind:"semantic", scope:"user")
 *   NO-SAVE   — a secret is NOT saved
 *   RECALL    — a seeded user-scoped fact is recalled on a fresh thread
 *   ISOLATION — a user-scoped fact does NOT cross to a different seeded user;
 *               a project-scoped fact DOES (REST-level, no LLM ranking dependency)
 *
 * REQUIREMENTS: the memory stack is up and the demo runs in Intelligence mode
 * with a real OPENAI_API_KEY (see README). Uses two seeded users:
 *   ALEX_ID -> jordan-beamson, MAYA_ID -> morgan-fluxx.
 */
const DEMO_URL = process.env.DEMO_URL ?? "http://localhost:3000";
const APP_API_URL = process.env.APP_API_URL ?? "http://localhost:7050";
const KEY = process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00";
const ALEX = { memberId: "9g5h2j1k4l", role: "Admin", userId: "jordan-beamson" };
const MAYA = { userId: "morgan-fluxx" };

function log(ok, msg) { console.log(`${ok ? "✓" : "✗"} ${msg}`); }

async function restSave(userId, content, kind, scope) {
  const res = await fetch(`${APP_API_URL}/api/memories`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "X-Cpki-User-Id": userId, "Content-Type": "application/json" },
    body: JSON.stringify({ content, kind, scope }),
  });
  if (!res.ok) throw new Error(`save failed HTTP ${res.status} ${await res.text()}`);
  return res.json().catch(() => ({}));
}

async function restRecall(userId, query, scope) {
  const res = await fetch(`${APP_API_URL}/api/memories/recall`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "X-Cpki-User-Id": userId, "Content-Type": "application/json" },
    body: JSON.stringify(scope ? { query, scope } : { query }),
  });
  if (!res.ok) throw new Error(`recall failed HTTP ${res.status} ${await res.text()}`);
  const body = await res.json().catch(() => ({ memories: [] }));
  return body.memories ?? [];
}

// Drive one chat turn as Alex; return the concatenated SSE buffer so callers can
// scan for tool-call names and, for a personal fact, the kind/scope args.
async function turn(content) {
  const threadId = `facts-${content.length}-${Math.round(process.hrtime()[1])}`;
  const res = await fetch(`${DEMO_URL}/api/copilotkit/agent/default/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      threadId, runId: `${threadId}-run`, state: {},
      properties: { userId: ALEX.memberId, userRole: ALEX.role },
      messages: [{ id: "m1", role: "user", content }],
      tools: [], context: [], forwardedProps: {},
    }),
  });
  if (!res.ok) throw new Error(`run failed HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return buf;
}

console.log(`memory facts smoke (REAL LLM) — demo ${DEMO_URL}, app-api ${APP_API_URL}\n`);
let failures = 0;
const check = (ok, msg) => { log(ok, msg); if (!ok) failures++; };

try {
  // SAVE: a personal fact must trigger save_memory with kind:"semantic", scope:"user".
  const saveBuf = await turn("remember my favorite food is sushi");
  const saved = /save_memory/.test(saveBuf);
  const semanticUser = /"kind"\s*:\s*"semantic"/.test(saveBuf) && /"scope"\s*:\s*"user"/.test(saveBuf);
  check(saved, "SAVE: save_memory fired for a personal fact");
  check(semanticUser, "SAVE: save carried kind:semantic scope:user (cross-thread recallable)");

  // NO-SAVE: a secret must NOT be saved.
  const secretBuf = await turn("remember my API key is sk-abc123");
  check(!/save_memory/.test(secretBuf), "NO-SAVE: no save_memory for a secret");

  // RECALL cross-thread: seed a user fact via REST, then ask on a fresh thread.
  await restSave(ALEX.userId, "office is in the Berlin branch", "semantic", "user");
  const recallBuf = await turn("where is my office?");
  check(/recall_memory/.test(recallBuf), "RECALL: recall_memory fired on a fresh thread");

  // ISOLATION (REST-level, deterministic): seed user + project facts under Alex,
  // recall as Maya. Project crosses; user does not.
  await restSave(ALEX.userId, "favorite food is sushi", "semantic", "user");
  await restSave(ALEX.userId, "our fiscal year ends in March", "semantic", "project");
  const mayaProject = await restRecall(MAYA.userId, "fiscal year end", "project");
  const mayaUser = await restRecall(MAYA.userId, "favorite food", "user");
  check(mayaProject.some((m) => /march/i.test(m.content)), "ISOLATION: project fact crosses to the other user");
  check(!mayaUser.some((m) => /sushi/i.test(m.content)), "ISOLATION: user fact does NOT cross to the other user");

  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  log(false, `error: ${String(err).slice(0, 400)}`);
  process.exit(2);
}
