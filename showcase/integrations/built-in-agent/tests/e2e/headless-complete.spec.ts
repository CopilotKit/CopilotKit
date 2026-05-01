import { test, expect } from "@playwright/test";

// E2E for the headless-complete demo. The headless surface does not render
// suggestion pills; the canonical e2e drives the feature via textarea-fill
// instead — typing the canonical message from
// showcase/aimock/_canonical-catalog.json and pressing Enter.

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with hand-rolled composer", async ({ page }) => {
    await expect(page.getByPlaceholder(/Type a message/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const input = page.getByPlaceholder(/Type a message\.\.\./i).first();
    await input.fill(
      "send a sample message to populate the headless transcript",
    );
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
