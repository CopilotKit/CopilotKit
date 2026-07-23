#!/usr/bin/env node
/**
 * Over-limit gate smoke test — the premise the self-learning "teach a workflow"
 * loop rests on.
 *
 * The narrated teach loop has the agent recall a saved procedure and apply it to
 * a *different* over-limit charge. That only clears the charge if the gate is
 * lifted *exclusively* by a finalized exception filed under a JUSTIFYING code
 * (see src/lib/store.ts `hasApprovedException` +
 * src/app/api/v1/policy-exception-codes.ts `isJustifying`). The Save card echoes
 * the demonstrated justifying code (EXC-BOARD-APPROVED) back to the agent as the
 * canonical procedure; if a non-justifying code also cleared the gate, or a
 * justifying one didn't, that procedure would be wrong. This guards that premise.
 *
 * Proves, against the running demo server, on one over-limit transaction:
 *   1. approve with NO exception                 → 422 OVER_POLICY_LIMIT (precondition)
 *   2. approve after a NON-justifying exception  → 422 OVER_POLICY_LIMIT (does not unlock)
 *   3. approve after a JUSTIFYING exception       → 201 (unlocks)
 *
 * The in-memory store mutates (step 3 approves the txn), so run this against a
 * freshly-started server, and restart the server before a live demo.
 *
 * Usage:
 *   node scripts/over-limit-gate-smoke.mjs
 * Env (optional):
 *   DEMO_URL       default http://localhost:3000
 *   GATE_TXN_ID    default t-3   (an over-limit pending seed txn NOT used in the demo beats)
 */

const DEMO_URL = process.env.DEMO_URL ?? "http://localhost:3000";
const TXN_ID = process.env.GATE_TXN_ID ?? "t-3";

// EXC-BOARD-APPROVED must stay in sync with the justifying code the Save card's
// CANONICAL_PROCEDURE echoes to the agent (src/app/page.tsx).
const JUSTIFYING_CODE = "EXC-BOARD-APPROVED";
const NON_JUSTIFYING_CODE = "EXC-WILL-REIMBURSE";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function approve(id) {
  const res = await fetch(`${DEMO_URL}/api/v1/transactions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function openException(transactionId, code) {
  const res = await fetch(`${DEMO_URL}/api/v1/exceptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId, code }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`open ${code}: HTTP ${res.status}`);
  return body.id;
}

async function finalize(exceptionId) {
  const res = await fetch(
    `${DEMO_URL}/api/v1/exceptions/${exceptionId}/finalize`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok) throw new Error(`finalize ${exceptionId}: HTTP ${res.status}`);
}

console.log(`over-limit gate smoke — ${DEMO_URL}, txn ${TXN_ID}\n`);

try {
  // 1. Precondition: the seed txn is over its policy limit and unapproved.
  const pre = await approve(TXN_ID);
  check(
    "1. approve with no exception is rejected",
    pre.status === 422 && pre.body?.error === "OVER_POLICY_LIMIT",
    `HTTP ${pre.status} ${pre.body?.error ?? ""}`,
  );

  // 2. A non-justifying exception files but does NOT lift the gate.
  const nonJustId = await openException(TXN_ID, NON_JUSTIFYING_CODE);
  await finalize(nonJustId);
  const afterNonJust = await approve(TXN_ID);
  check(
    "2. non-justifying exception does not unlock approval",
    afterNonJust.status === 422 &&
      afterNonJust.body?.error === "OVER_POLICY_LIMIT",
    `HTTP ${afterNonJust.status} ${afterNonJust.body?.error ?? ""}`,
  );

  // 3. A justifying exception lifts the gate — approval now succeeds.
  const justId = await openException(TXN_ID, JUSTIFYING_CODE);
  await finalize(justId);
  const afterJust = await approve(TXN_ID);
  check(
    "3. justifying exception unlocks approval",
    afterJust.status === 201,
    `HTTP ${afterJust.status}`,
  );
} catch (error) {
  check("gate smoke", false, String(error).slice(0, 200));
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length > 0) {
  console.log(
    "hint: run against a FRESHLY-started server (the in-memory store mutates; " +
      "a prior run leaves the txn approved). Confirm the seed txn is over-limit.",
  );
}
process.exit(failed.length === 0 ? 0 : 1);
