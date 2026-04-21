import { test, expect } from "@playwright/test";

test.describe("Human in the Loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator(".copilotKitAssistantMessage").first(),
    ).toBeVisible({
      timeout: 30000,
    });
  });

  test("task request shows step selector with checkboxes", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Create a plan with steps to organize a team offsite event",
    );
    await input.press("Enter");

    // The HITL demo surfaces a single StepSelector card regardless of whether the
    // underlying flow is an interrupt hook or a frontend HITL tool — assert on that.
    const stepSelector = page.locator('[data-testid="select-steps"]');
    await expect(stepSelector.first()).toBeVisible({ timeout: 60000 });

    // Should have at least one step item with a checkbox
    const stepItems = page.locator('[data-testid="step-item"]');
    await expect(stepItems.first()).toBeVisible({ timeout: 5000 });

    // Each step should have a checkbox input
    const checkbox = stepItems.first().locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();

    // Each step should have descriptive text
    const stepText = stepItems.first().locator('[data-testid="step-text"]');
    await expect(stepText).not.toBeEmpty();
  });

  test("step selector shows enabled count and has action button", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan the steps to write a quarterly report");
    await input.press("Enter");

    const stepSelector = page.locator('[data-testid="select-steps"]').first();
    await expect(stepSelector).toBeVisible({ timeout: 60000 });

    // Should show a count indicator (e.g., "3/3 selected")
    await expect(stepSelector.getByText(/\d+\/\d+\s*selected/)).toBeVisible();

    // Should have either a "Perform Steps" button (interrupt) or Confirm/Reject buttons (HITL)
    const actionButton = stepSelector.locator("button").first();
    await expect(actionButton).toBeVisible();
  });

  test("can approve a step selection and agent continues", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan a trip to mars in 5 steps");
    await input.press("Enter");

    // Wait for step selector
    const selector = page.locator('[data-testid="select-steps"]');
    await expect(selector).toBeVisible({ timeout: 60000 });

    // Find and click the action button (Perform Steps / Confirm)
    const actionBtn = page.locator(
      'button:has-text("Perform"), button:has-text("Confirm")',
    );
    await expect(actionBtn.first()).toBeVisible({ timeout: 5000 });
    await actionBtn.first().click();

    // After approval, the step selector's action button should disappear
    // (StepSelector unmounts after onConfirm; StepsFeedback replaces buttons with
    // the "Accepted" or "Rejected" banner). Assert on a post-click transition
    // that does NOT match the pre-click "N/N selected" counter text.
    await expect(actionBtn.first()).not.toBeVisible({ timeout: 10000 });
  });
});
