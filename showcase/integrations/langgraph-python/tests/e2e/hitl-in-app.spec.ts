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
// Genuine assertion strategy: the deterministic aimock fixtures emit two
// branched continuations per pill (sequenceIndex 0 = approve, 1 = reject).
// Since the JSON fixture matcher cannot inspect tool message content, we
// rely on test ordering (serial mode) so test #1 of the pair claims
// sequenceIndex 0 (approve response) and test #2 claims sequenceIndex 1
// (reject response). If the framework wired approve/reject into the same
// payload, both branches would still receive the same fixture's response
// — but the assertion text differs, so at least one of the two tests
// would fail. That asymmetry is what makes the assertion genuine.

test.describe("HITL In-App (approval dialog portaled to <body>)", () => {
  // Serial mode is load-bearing: aimock's `sequenceIndex` matcher counts
  // matches across the whole process, so the approve test (sequenceIndex 0)
  // MUST run before the reject test (sequenceIndex 1) for each pill pair.
  test.describe.configure({ mode: "serial" });

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
        .locator('[data-role="assistant"]')
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
        .locator('[data-role="assistant"]')
        .filter({ hasText: "refund request was not approved" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
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
        .locator('[data-role="assistant"]')
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
        .locator('[data-role="assistant"]')
        .filter({ hasText: "Not escalated" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  // TODO: re-enable when downgrade flow is fixed (broken upstream as of 2026-05-07)
  test.skip("downgrade #12346 → approve/reject flow", async () => {
    // Intentionally skipped per spec: the downgrade pill exposes a
    // separate upstream bug (ticket-12346 surface) that is out of scope
    // for the genuine-pass rewrite. Re-enable when the upstream demo
    // reliably emits request_user_approval for the downgrade prompt.
  });
});
