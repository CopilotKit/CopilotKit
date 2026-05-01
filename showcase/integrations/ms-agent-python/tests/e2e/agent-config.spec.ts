import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the agent-config demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Agent Config — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("Personalize tone canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Personalize tone/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
