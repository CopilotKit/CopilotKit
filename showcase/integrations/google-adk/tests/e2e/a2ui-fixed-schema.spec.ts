import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for a2ui-fixed-schema.
test.describe("A2UI Fixed Schema — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("Block calendar suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Block calendar/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // Pill click sends the canonical message; the user bubble proves the
    // composer was populated and submitted with the pill's exact text.
    await expect(
      page.getByText("block out my tuesday with three meetings and a gym slot"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
