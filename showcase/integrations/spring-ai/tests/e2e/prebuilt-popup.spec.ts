import { test, expect } from "@playwright/test";

test.describe("Prebuilt Popup", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByRole("heading", {
        name: "Popup demo — look for the floating launcher",
      }),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Popup hello/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator("[data-testid=\"copilot-popup\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
