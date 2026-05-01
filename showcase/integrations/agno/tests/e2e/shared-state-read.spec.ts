import { test, expect } from "@playwright/test";

test.describe("Shared State (Reading)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read");
  });

  test("page loads with Sales Pipeline dashboard", async ({ page }) => {
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 10000,
    });
  });

  test("dashboard shows pipeline summary with Total Pipeline metric", async ({
    page,
  }) => {
    await expect(page.getByText("Total Pipeline")).toBeVisible({
      timeout: 10000,
    });
  });

  test("sidebar is open with Sales Pipeline Assistant title", async ({
    page,
  }) => {
    await expect(page.getByText("Sales Pipeline Assistant")).toBeVisible({
      timeout: 10000,
    });

    // Sidebar should have a chat input
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("can send message through sidebar and get response", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Summarize the current sales pipeline");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("dashboard shows deal list or empty state", async ({ page }) => {
    // Either shows deals with "Active Deals" / "Closed" columns, or empty state
    const hasDealList = page.getByText("Active Deals");
    const hasEmptyState = page.getByText("No deals yet");

    await expect(hasDealList.or(hasEmptyState).first()).toBeVisible({
      timeout: 10000,
    });
  });

  // Canonical e2e suggestion — single "Italian pasta" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and the assistant responds with shared-state context applied.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Italian pasta" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });
});
