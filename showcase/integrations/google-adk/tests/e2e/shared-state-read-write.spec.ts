import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for shared-state-read-write.
test.describe("Shared State (Read/Write) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
  });

  test("Weekend plan suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("build me a weekend itinerary based on saved interests"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
