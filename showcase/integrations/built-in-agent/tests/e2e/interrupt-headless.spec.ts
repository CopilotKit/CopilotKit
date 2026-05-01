import { test, expect } from "@playwright/test";

// E2E for the interrupt-headless demo — exercises the canonical suggestion
// pill registered by `useConfigureSuggestions` in page.tsx.

test.describe("Interrupt Headless", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Headless interrupt/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // catalog primarySelector is [data-message-role="assistant"] for this
    // demo — keeps the assertion stable against the inline transcript.
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
