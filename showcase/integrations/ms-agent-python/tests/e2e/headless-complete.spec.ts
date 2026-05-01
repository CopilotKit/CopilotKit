import { test, expect } from "@playwright/test";

// Canonical e2e textarea-fill coverage for the headless-complete demo.
// The headless demo doesn't render suggestion pills — the catalog message
// from showcase/aimock/_canonical-catalog.json is typed into the demo's
// custom textarea instead, exercising the same fixture path.
test.describe("Headless Complete — canonical textarea-fill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("typing the catalog message into the textarea sends to agent", async ({
    page,
  }) => {
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill(
      "send a sample message to populate the headless transcript",
    );

    // Submit via Enter key — the headless input's onKeyDown handler dispatches
    // when Enter is pressed without Shift.
    await textarea.press("Enter");

    // Selector divergence fallback: data-message-role is the role attribute
    // the headless message-list uses; assistant or any role appearing means
    // the agent path has fired.
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
