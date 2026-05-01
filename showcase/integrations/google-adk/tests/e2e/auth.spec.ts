import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for auth.
test.describe("Auth — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("Auth check suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Auth check/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.getByText("auth check turn 1")).toBeVisible({
      timeout: 30_000,
    });
  });
});
