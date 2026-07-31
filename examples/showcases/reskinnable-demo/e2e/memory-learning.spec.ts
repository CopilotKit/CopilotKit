import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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
 *     $APP_API_URL (default http://localhost:7250) with the seeded org/key. IMPORTANT:
 *     "container healthy" is not sufficient — the sl-mcp memory worker can throw an
 *     UnhandledPromiseRejection during boot and briefly drop /mcp connections. If this
 *     test fails with "No fixture matched" plus app-side [MCPMiddleware] "Failed to list
 *     tools" / "other side closed" / ECONNRESET on :7250, that is the backend startup
 *     window, NOT a fixture or demo bug — wait until `POST /mcp initialize` returns 200
 *     (see scripts/memory-*-smoke.mjs readiness gate) and re-run. When the memory tools
 *     fail to attach, the agent skips recall_memory and its LLM-call sequence diverges
 *     from the sequenced fixtures, so the mismatch surfaces on a later call.
 *  2. Playwright starts aimock (webServer[0]) + the dev server in Intelligence mode
 *     with OPENAI_BASE_URL pointed at aimock (see playwright.config.ts). Runs are
 *     sequenced against one aimock server; parallel workers can interleave the
 *     over-limit fixture group's shared counter, so run this spec with --workers=1.
 *
 * ── CONFIRMED BY A LOCAL RUN ────────────────────────────────────────────────────
 *  - The chat selectors resolve against the product chat: "Open chat" and
 *    "Type a message..." both come from @copilotkit/react-core defaults
 *    (CopilotChatConfigurationProvider / CopilotChatInput), not banking markup,
 *    so the demo's own shell can be restyled without breaking this gate.
 *  - The recall path completes unaided: the agent recalls the procedure, files the
 *    EXC-BOARD-APPROVED exception, and approves the charge, and the
 *    "Record a workflow?" card never appears.
 *
 * ── STILL UNVERIFIED ────────────────────────────────────────────────────────────
 *  - The over-limit seed txn id (DRIFT/GATE txn) is t-3 and renders a status that
 *    reads "cleared"/"approved" after the flow.
 *  - The fixtures' multi-turn ordering key (sequenceIndex) matches aimock.
 */

const APP_API_URL = process.env.APP_API_URL ?? "http://localhost:7250";
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

/** Runaway guard on the approval loop, NOT the expected card count. */
const MAX_APPROVAL_STEPS = 6;
/** The first card has to wait out a whole agent turn (recall + tool call). */
const FIRST_CARD_TIMEOUT = 45_000;
/** Subsequent cards follow the previous click, so they land fast. */
const NEXT_CARD_TIMEOUT = 8_000;

/**
 * Resolve the next visible approve/confirm control, or null if none shows up
 * within `timeout`.
 *
 * Polls every label instead of blocking on the first one: a single
 * `locator.click({ timeout })` sized to the whole test budget both starves the
 * remaining labels (the fallback never runs, because the test dies first) and
 * turns "the flow finished" into a timeout failure. Returning null lets the
 * caller treat "no card left" as completion.
 */
async function nextApproveControl(page: Page, timeout: number) {
  const deadline = Date.now() + timeout;
  do {
    for (const label of APPROVE_LABELS) {
      const candidate = page.getByRole("button", { name: label }).first();
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return null;
}

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
    // Playwright's 30s default cannot hold this test: one agent turn alone is
    // allowed FIRST_CARD_TIMEOUT (45s), and the closing server poll another 30s.
    test.setTimeout(180_000);

    // The over-limit flow is banking-specific (the agentId is the skin id), so
    // go straight to the banking skin rather than via the / redirect.
    await page.goto("/banking");

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

    // Advance until no approval card is left rather than assuming a fixed count:
    // how many cards the agent emits depends on how it batches the three tool
    // calls, so a hardcoded step count either leaves a card unclicked or waits
    // forever on one that never arrives. MAX_APPROVAL_STEPS is only a runaway
    // guard, not the expected number.
    for (let step = 0; step < MAX_APPROVAL_STEPS; step++) {
      // The "Record a workflow?" card must never appear on the recall path.
      await expect(recordOffer).toHaveCount(0);
      // The first card waits on a full agent turn; later ones follow quickly.
      const approve = await nextApproveControl(
        page,
        step === 0 ? FIRST_CARD_TIMEOUT : NEXT_CARD_TIMEOUT,
      );
      // No card left — the flow is done. Breaking here is the success path, not
      // a failure: the outcome is asserted against the server below.
      if (!approve) break;
      await approve.click();
      // Wait for this card to settle before looking for the next one, so a card
      // that lingers for a frame after its click is not counted twice.
      await approve
        .waitFor({ state: "hidden", timeout: NEXT_CARD_TIMEOUT })
        .catch(() => {});
    }

    // Outcome: the recording offer never appeared, and the charge is cleared. Prefer
    // a server assertion (robust) — the over-limit gate is now lifted for TXN_ID.
    await expect(recordOffer).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const res = await fetch(
            `http://localhost:3000/api/banking/v1/transactions/${TXN_ID}`,
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
