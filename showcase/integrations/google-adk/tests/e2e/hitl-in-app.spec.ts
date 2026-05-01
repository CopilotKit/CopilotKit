import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for hitl-in-app.
test.describe("HITL (In App) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("Refund approval suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Refund approval/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("process a refund for the late delivery ticket"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
