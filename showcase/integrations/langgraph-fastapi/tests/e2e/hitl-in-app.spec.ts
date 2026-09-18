import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// QA reference: qa/hitl-in-app.md
// request_user_approval returns { approved, reason? } from the body portal.
// Fixtures match the current tool result's Boolean decision and call ID.
// Approve and reject must produce different, non-contradictory narration;
// neither test order nor process-global sequence counters choose the outcome.

async function openApproval(page: Page, title: string, ticket: string) {
  await page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first()
    .click();
  const modal = page.locator('body > [data-testid="approval-dialog-overlay"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await expect(modal.getByText(ticket).first()).toBeVisible();
  await expect(page.getByTestId("approval-dialog")).toBeVisible();
  await expect(page.getByTestId("approval-dialog-reason")).toBeVisible();
}

async function resolveApproval(page: Page, decision: "approve" | "reject") {
  await page.getByTestId(`approval-dialog-${decision}`).click();
  await expect(page.getByTestId("approval-dialog-overlay")).toHaveCount(0, {
    timeout: 5_000,
  });
}

async function expectOutcome(page: Page, expected: string, opposite: string) {
  const message = page
    .locator('[data-testid="copilot-assistant-message"]')
    .filter({ hasText: expected })
    .first();
  await expect(message).toBeVisible({ timeout: 60_000 });
  await expect(message).not.toContainText(opposite);
  await expect(page.getByTestId("approval-dialog-overlay")).toHaveCount(0);
}

const decisions = [
  {
    name: "refund #12345 → approve → assistant confirms processing",
    pill: "Approve refund for #12345",
    ticket: "#12345",
    decision: "approve",
    expected: "I am processing the $50 refund",
    opposite: "refund request was not approved",
  },
  {
    name: "refund #12345 → reject → assistant acknowledges rejection",
    pill: "Approve refund for #12345",
    ticket: "#12345",
    decision: "reject",
    expected: "refund request was not approved",
    opposite: "I am processing the $50 refund",
  },
  {
    name: "escalate #12347 → approve → assistant confirms escalation",
    pill: "Escalate ticket #12347",
    ticket: "#12347",
    decision: "approve",
    expected: "Escalated ticket #12347",
    opposite: "Not escalated",
  },
  {
    name: "escalate #12347 → reject → assistant acknowledges non-escalation",
    pill: "Escalate ticket #12347",
    ticket: "#12347",
    decision: "reject",
    expected: "Not escalated",
    opposite: "Escalated ticket #12347",
  },
  {
    name: "downgrade #12346 → approve → assistant confirms downgrade",
    pill: "Downgrade plan for #12346",
    ticket: "#12346",
    decision: "approve",
    expected: "Downgrade confirmed",
    opposite: "Downgrade not approved",
  },
  {
    name: "downgrade #12346 → reject → assistant preserves the current plan",
    pill: "Downgrade plan for #12346",
    ticket: "#12346",
    decision: "reject",
    expected: "Downgrade not approved",
    opposite: "Downgrade confirmed",
  },
] as const;

test.describe("HITL In-App (approval dialog portaled to <body>)", () => {
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
    await expect(page.getByTestId("approval-dialog-overlay")).toHaveCount(0);
  });

  test("suggestion pills reference each open ticket", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of [
      "Approve refund for #12345",
      "Downgrade plan for #12346",
      "Escalate ticket #12347",
    ]) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  for (const scenario of decisions) {
    test(scenario.name, async ({ page }) => {
      await openApproval(page, scenario.pill, scenario.ticket);
      await resolveApproval(page, scenario.decision);
      await expectOutcome(page, scenario.expected, scenario.opposite);
    });
  }

  // A prior tool result must not prevent the next user turn from opening
  // its own approval dialog; the current result must not reopen that dialog.
  test("approve refund then click escalate — each pill mounts its own approval dialog", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openApproval(page, "Approve refund for #12345", "#12345");
    await resolveApproval(page, "approve");
    await expectOutcome(
      page,
      "processing the $50 refund",
      "refund request was not approved",
    );
    await openApproval(page, "Escalate ticket #12347", "#12347");
    await resolveApproval(page, "approve");
    await expectOutcome(page, "Escalated ticket #12347", "Not escalated");
  });
});
