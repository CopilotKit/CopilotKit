import { test, expect } from "@playwright/test";

// QA reference: qa/hitl-in-app.md
// Demo source: src/app/demos/hitl-in-app/{page.tsx, approval-dialog.tsx}
//
// Demo registers ONE frontend tool via `useFrontendTool`:
// `request_user_approval(message, context?)`. The handler returns a Promise
// whose `resolve` is stashed in state; the parent renders `ApprovalDialog`,
// portal'd to `document.body` via `createPortal` — so the modal lives
// OUTSIDE the chat transcript. Approve / Reject click resolves the tool
// promise with `{ approved, reason? }` and hands it back to the agent.
//
// Genuine assertion strategy: the .NET runtime suffixes frontend tool result
// IDs with the actual `{ approved: true | false }` decision before sending the
// continuation to aimock. The fixtures branch on that suffixed toolCallId, so
// approve/reject order no longer depends on process-global sequence counters.

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

  test("refund #12345 → approve → assistant confirms processing", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Approve refund for #12345" })
      .first()
      .click();

    // Modal mounts as a DIRECT child of <body> (createPortal contract).
    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("approval-dialog")).toBeVisible();
    await expect(page.getByTestId("approval-dialog-reason")).toBeVisible();

    await page.getByTestId("approval-dialog-approve").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    // Approve branch: deterministic fixture leading phrase.
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "I am processing the $50 refund" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("refund #12345 → reject → assistant acknowledges rejection", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Approve refund for #12345" })
      .first()
      .click();

    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("approval-dialog-reject").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    // Reject branch: deterministic fixture leading phrase. Substring
    // assertion is intentional — locks the reject-branch identity.
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "refund request was not approved" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("reject refund then click the same pill again opens a fresh approval dialog", async ({
    page,
  }) => {
    const refundPill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Approve refund for #12345" });

    await refundPill.first().click();
    await expect(
      page.locator('body > [data-testid="approval-dialog-overlay"]'),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("approval-dialog-reject").click();

    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "refund request was not approved" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    await refundPill.first().click();
    const secondDialog = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(secondDialog).toBeVisible({ timeout: 60_000 });
    await expect(secondDialog.getByText(/#12345/).first()).toBeVisible();
  });

  test("escalate #12347 → approve → assistant confirms escalation", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Escalate ticket #12347" })
      .first()
      .click();

    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("approval-dialog-approve").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    // Approve branch leading phrase: "Escalated ticket #12347 ...".
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "Escalated ticket #12347" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("escalate #12347 → reject → assistant acknowledges non-escalation", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Escalate ticket #12347" })
      .first()
      .click();

    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("approval-dialog-reject").click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    // Reject branch leading phrase: "Not escalated ...".
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "Not escalated" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("downgrade #12346 -> approve, then repeat -> reject uses separate branches", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const downgradePill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Downgrade plan for #12346" });

    await downgradePill.first().click();

    const firstDialog = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(firstDialog).toBeVisible({ timeout: 60_000 });
    await expect(firstDialog.getByText(/#12346/).first()).toBeVisible();

    await page.getByTestId("approval-dialog-approve").click();
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "Downgrade confirmed" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    await downgradePill.first().click();

    const secondDialog = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(secondDialog).toBeVisible({ timeout: 60_000 });
    await expect(secondDialog.getByText(/#12346/).first()).toBeVisible();

    await page.getByTestId("approval-dialog-reject").click();
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "downgrade request was not approved" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  // Regression for the aimock multi-pill bug:
  // The refund (#12345) and escalate (#12347) fixtures used
  // `hasToolResult: false/true` to split the request_user_approval emit
  // from the approve/reject narration. After approving the first pill, the
  // thread already had a tool result, so the second pill's first-turn
  // fixture was skipped — the approve/reject branch fired immediately with
  // no approval dialog. Fix: chain the follow-up fixtures via the
  // request_user_approval `toolCallId`, drop `hasToolResult: false` from
  // the tool-emitting fixture. This test approves refund #12345 then
  // clicks escalate #12347 in the same thread and asserts the second pill
  // mounts its own approval dialog.
  test("approve refund then click escalate — each pill mounts its own approval dialog", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Approve refund for #12345" })
      .first()
      .click();

    const refundDialog = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(refundDialog).toBeVisible({ timeout: 60_000 });
    // The first dialog targets ticket #12345.
    await expect(refundDialog.getByText(/#12345/).first()).toBeVisible();

    await page.getByTestId("approval-dialog-approve").click();
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 5_000 });

    // First pill's approve narration lands before we click the next pill.
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "processing the $50 refund" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    // Second pill: must trigger its OWN request_user_approval tool call
    // and mount a fresh approval dialog targeting ticket #12347.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Escalate ticket #12347" })
      .first()
      .click();

    const escalateDialog = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(escalateDialog).toBeVisible({ timeout: 60_000 });
    await expect(escalateDialog.getByText(/#12347/).first()).toBeVisible();
  });
});
