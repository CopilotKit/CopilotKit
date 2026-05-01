import { test, expect } from "@playwright/test";

// Canonical e2e textarea-fill coverage for the headless-simple demo.
// The headless demo doesn't render suggestion pills — the catalog message
// from showcase/aimock/_canonical-catalog.json is typed into the demo's
// custom textarea instead.
test.describe("Headless Simple — canonical textarea-fill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("typing the catalog message into the textarea sends to agent", async ({
    page,
  }) => {
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill("show a small card body about hummingbirds");
    await textarea.press("Enter");

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
