import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with main content and popup chat", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /popup demo/i }),
    ).toBeVisible();
    // CopilotPopup is open by default — the custom placeholder should appear.
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible({ timeout: 15000 });
  });
});
