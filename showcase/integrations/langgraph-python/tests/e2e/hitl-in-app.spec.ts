import { test, expect } from "@playwright/test";

// QA reference: qa/hitl-in-app.md
// Demo source: src/app/demos/hitl-in-app/{page.tsx, approval-dialog.tsx}
//
// Demo registers ONE frontend tool via `useFrontendTool`:
// `request_user_approval(message, context?)`. The handler returns a Promise
// whose `resolve` is stashed in state; the parent renders `ApprovalDialog`,
// portal'd to `document.body` via `createPortal` — so the modal lives
// OUTSIDE the chat transcript. Approve / Reject click resolves the tool
// promise with { approved, reason? } and hands it back to the agent.
//
// Suggestion pill clicks were observed to not always trigger the tool on
// Railway, so each flow sends an explicit typed prompt that names the tool
// plus the specific ticket. We assert on testid signals (card visibility,
// body-level portal location, button clicks) — no LLM-text assertions.

test.describe("HITL In-App (approval dialog portaled to <body>)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("page loads with 3 tickets, chat input, and no open modal", async ({
    page,
  }) => {
    await expect(page.getByTestId("ticket-12345")).toBeVisible();
    await expect(page.getByTestId("ticket-12346")).toBeVisible();
    await expect(page.getByTestId("ticket-12347")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0);
  });

  test("suggestion pills reference each open ticket", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Approve refund for #12345" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions.filter({ hasText: "Downgrade plan for #12346" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions.filter({ hasText: "Escalate ticket #12347" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // SKIP: `request_user_approval` is a `useFrontendTool` call that requires
  // the agent to actually invoke the tool in response to the typed prompt.
  // On Railway (`showcase-langgraph-python-production.up.railway.app`) the
  // graph does not reliably call the tool within 60s, so the body-portalled
  // dialog never appears. See W8-5 for details. Un-skip when the agent
  // deployment is fixed.
  test.skip("approve path: modal is body-portal'd, resolves, chat continues", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use request_user_approval to ask me to approve a $50 refund on ticket #12345.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Modal appears as a DIRECT child of <body> (createPortal contract).
    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("approval-dialog")).toBeVisible();
    await expect(page.getByTestId("approval-dialog-reason")).toBeVisible();

    await page
      .getByTestId("approval-dialog-reason")
      .fill("Verified duplicate charge");
    await page.getByTestId("approval-dialog-approve").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45_000,
    });
  });

  // SKIP: same root cause as the approve path — see W8-5.
  test.skip("reject path: modal closes on reject, agent still replies", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use request_user_approval to ask me to approve downgrading ticket #12346 to the Starter plan.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });

    await page
      .getByTestId("approval-dialog-reason")
      .fill("Customer must confirm in writing first");
    await page.getByTestId("approval-dialog-reject").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45_000,
    });
  });

  // SKIP: same root cause as the approve path — see W8-5. This case is the
  // most variable (trim()==="" branch occasionally fires), but inconsistently.
  test.skip("empty-reason approve path: modal closes and flow completes", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use request_user_approval to confirm escalating ticket #12347 to the payments team.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });

    // Leave reason empty — handler treats trim() === "" as undefined.
    await page.getByTestId("approval-dialog-approve").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });
  });
});
