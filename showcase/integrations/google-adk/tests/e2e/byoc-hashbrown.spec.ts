import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for byoc-hashbrown.
test.describe("BYOC Hashbrown — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("Sales overview suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("sketch the sales overview with quarterly bars"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
