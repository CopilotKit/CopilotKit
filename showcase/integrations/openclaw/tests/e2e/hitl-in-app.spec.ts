import { test, expect } from "@playwright/test";

// Behavioral e2e for the hitl-in-app demo (OpenClaw), run against aimock.
//
// The demo registers ONE frontend tool via `useFrontendTool`:
// `request_user_approval(message, context?)`. The handler returns a Promise
// whose `resolve` is stashed in state; the parent renders <ApprovalDialog>,
// portal'd to document.body via createPortal — so the modal lives OUTSIDE the
// chat transcript. OpenClaw does a multi-call loop: call #1 (hasToolResult:
// false) emits the request_user_approval toolCall (opening the dialog); after
// the user clicks Approve/Reject the tool result flows back and call #2
// (hasToolResult: true) returns a text confirmation. Prompts match
// showcase/aimock/d4/openclaw/chat.json.
test.describe("HITL In-App (approval dialog portaled to <body>)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("page loads with 3 tickets, chat input, and no open modal", async ({
    page,
  }) => {
    await expect(page.getByTestId("ticket-12345")).toBeVisible({
      timeout: 20000,
    });
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
      suggestions.filter({ hasText: "Escalate ticket #12347" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("refund #12345 → approval dialog opens → approve → assistant confirms", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Approve refund for #12345" })
      .first()
      .click();

    // The modal mounts as a DIRECT child of <body> (createPortal contract).
    const bodyModal = page.locator(
      'body > [data-testid="approval-dialog-overlay"]',
    );
    await expect(bodyModal).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("approval-dialog")).toBeVisible();
    await expect(page.getByTestId("approval-dialog-reason")).toBeVisible();

    await page.getByTestId("approval-dialog-approve").click();

    // Dialog closes once the tool promise resolves.
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]'),
    ).toHaveCount(0, { timeout: 10_000 });

    // The second-call (hasToolResult: true) fixture returns a text
    // confirmation — assert an assistant bubble appears after resolution.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("escalate #12347 → approval dialog opens → reject → assistant follows up", async ({
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
    ).toHaveCount(0, { timeout: 10_000 });

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
