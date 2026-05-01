import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for agent-config.
test.describe("Agent Config — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("Personalize tone suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Personalize tone/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("introduce yourself per your config"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
