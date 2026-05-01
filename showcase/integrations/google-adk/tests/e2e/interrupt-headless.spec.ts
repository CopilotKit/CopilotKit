import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for interrupt-headless.
test.describe("Interrupt (Headless) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("Headless interrupt suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Headless interrupt/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.getByText("trigger the headless interrupt")).toBeVisible({
      timeout: 30_000,
    });
  });
});
