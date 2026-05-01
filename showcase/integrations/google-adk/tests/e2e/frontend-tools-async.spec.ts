import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for frontend-tools-async.
test.describe("Frontend Tools (Async) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("Async metric suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Async metric/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.getByText("fetch the async metric")).toBeVisible({
      timeout: 30_000,
    });
  });
});
