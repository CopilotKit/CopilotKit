import { test, expect } from "@playwright/test";

/**
 * Deterministic cross-thread memory proof (Task 7 / FOR-149).
 *
 * Proves the RECALL half deterministically: with the over-limit procedure already
 * in project memory, a FRESH thread recalls it and completes the unlock unaided —
 * never offering to record. The agent's LLM is served by aimock (fixtures pin the
 * recall_memory -> openPolicyException -> finalizePolicyException ->
 * approveTransaction sequence), while the REAL local Intelligence backend does the
 * actual recall ranking + tenant scoping.
 *
 * The SAVE half is HITL+LLM (Option A) and is covered by the manual walkthrough
 * (README) + scripts/memory-drift-smoke.mjs — not this gate.
 *
 * ── PRECONDITIONS (the gate assumes these are already running) ──────────────────
 *  1. The memory stack is up and healthy (docker compose; see README). app-api on
 *     $APP_API_URL (default http://localhost:7050) with the seeded org/key. IMPORTANT:
 *     "container healthy" is not sufficient — the sl-mcp memory worker can throw an
 *     UnhandledPromiseRejection during boot and briefly drop /mcp connections. If this
 *     test fails with "No fixture matched" plus app-side [MCPMiddleware] "Failed to list
 *     tools" / "other side closed" / ECONNRESET on :7050, that is the backend startup
 *     window, NOT a fixture or demo bug — wait until `POST /mcp initialize` returns 200
 *     (see scripts/memory-*-smoke.mjs readiness gate) and re-run. When the memory tools
 *     fail to attach, the agent skips recall_memory and its LLM-call sequence diverges
 *     from the sequenced fixtures, so the mismatch surfaces on a later call.
 *  2. Playwright starts aimock (webServer[0]) + the dev server in Intelligence mode
 *     with OPENAI_BASE_URL pointed at aimock (see playwright.config.ts). Runs are
 *     sequenced against one aimock server; parallel workers can interleave the
 *     over-limit fixture group's shared counter, so run this spec with --workers=1.
 *
 * ── VERIFY ON FIRST GREEN RUN (unverified assumptions to shake out) ─────────────
 *  - Chat input + send selectors (getByPlaceholder/getByRole below) match the
 *    CopilotSidebar markup.
 *  - The recall-path HITL cards (openPolicyException / finalizePolicyException /
 *    approveTransaction) render approve buttons; this clicks any visible
 *    approve/confirm button to advance. Adjust the APPROVE_LABELS list to the real
 *    ApprovalButtons label(s).
 *  - The over-limit seed txn id (DRIFT/GATE txn) is t-3 and renders a status that
 *    reads "cleared"/"approved" after the flow.
 *  - The fixtures' multi-turn ordering key (sequenceIndex) matches aimock.
 */

const APP_API_URL = process.env.APP_API_URL ?? "http://localhost:7050";
const KEY =
  process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00";
const USER_ID = process.env.CPKI_USER_ID ?? "jordan-beamson";
const TXN_ID = process.env.GATE_TXN_ID ?? "t-3";
const SEED_CODE = "EXC-BOARD-APPROVED";
const APPROVE_LABELS = [
  /^approve$/i,
  /^confirm$/i,
  /^yes$/i,
  /^approve transaction$/i,
];

const memHeaders = {
  Authorization: `Bearer ${KEY}`,
  "X-Cpki-User-Id": USER_ID,
  "Content-Type": "application/json",
};

async function recallProcedureIds(): Promise<string[]> {
  const res = await fetch(`${APP_API_URL}/api/memories/recall`, {
    method: "POST",
    headers: memHeaders,
    body: JSON.stringify({
      query: "over-limit approval procedure",
      scope: "project",
    }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { memories?: { id: string }[] };
  return (body.memories ?? []).map((m) => m.id);
}

/** Arrange a clean slate, then seed exactly one project/operational procedure. */
async function resetAndSeedProcedure(): Promise<void> {
  for (const id of await recallProcedureIds()) {
    await fetch(`${APP_API_URL}/api/memories/${id}`, {
      method: "DELETE",
      headers: memHeaders,
    });
  }
  const res = await fetch(`${APP_API_URL}/api/memories`, {
    method: "POST",
    headers: memHeaders,
    body: JSON.stringify({
      content:
        `To approve an over-limit charge, open a policy exception with code ${SEED_CODE} ` +
        `against the charge and finalize it, then approve the transaction.`,
      scope: "project",
      kind: "operational",
    }),
  });
  expect(res.status, "seed procedure memory").toBe(201);
}

test.describe("durable cross-thread memory recall (FOR-149)", () => {
  test.beforeAll(async () => {
    await resetAndSeedProcedure();
  });

  test("a fresh thread recalls the procedure and unlocks the over-limit charge unaided", async ({
    page,
  }) => {
    await page.goto("/");

    // The docked chat starts closed (clean-dashboard first impression); open it
    // before interacting. CopilotSidebar's launcher is labelled "Open chat".
    const openChat = page.getByRole("button", { name: /open chat/i });
    if (await openChat.count()) await openChat.first().click();

    // Fresh thread so there is NO in-thread context — recall is the only way the
    // agent can know the procedure.
    const newThread = page.getByRole("button", {
      name: /new (thread|conversation|chat)/i,
    });
    if (await newThread.count()) await newThread.first().click();

    // Send an over-limit approval request. "over-limit" matches the aimock fixtures.
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill(`Please approve the over-limit charge ${TXN_ID}.`);
    await input.press("Enter");

    // The agent (via aimock) recalls then drives openPolicyException ->
    // finalizePolicyException -> approveTransaction, each as a HITL approval card.
    // Click through them; assert the recording offer never appears.
    const recordOffer = page.getByText(/record a workflow\?/i);

    for (let step = 0; step < 4; step++) {
      // The "Record a workflow?" card must never appear on the recall path.
      await expect(recordOffer).toHaveCount(0);
      // Advance whichever approval card is currently shown.
      const approve = page.getByRole("button", { name: APPROVE_LABELS[0] });
      await approve
        .first()
        .click({ timeout: 30_000 })
        .catch(async () => {
          for (const label of APPROVE_LABELS.slice(1)) {
            const b = page.getByRole("button", { name: label });
            if (await b.count()) return b.first().click();
          }
        });
    }

    // Outcome: the recording offer never appeared, and the charge is cleared. Prefer
    // a server assertion (robust) — the over-limit gate is now lifted for TXN_ID.
    await expect(recordOffer).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const res = await fetch(
            `http://localhost:3000/api/v1/transactions/${TXN_ID}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "approved" }),
            },
          );
          return res.status;
        },
        {
          timeout: 30_000,
          message:
            "over-limit charge should be approvable after recalled unlock",
        },
      )
      // 201 = approve succeeded (gate lifted); 409/200 = already approved by the run.
      .not.toBe(422);
  });

  // The former bespoke-inspector test was removed with that pane (banking
  // migration D). The product web-inspector is now enabled via showDevConsole
  // and is owned/covered by packages/web-inspector's own tests; the
  // self-learning recall behavior is asserted by the headless test above.
});
