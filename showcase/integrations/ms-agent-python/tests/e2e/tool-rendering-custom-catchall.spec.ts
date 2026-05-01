import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the tool-rendering-custom-catchall demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Tool Rendering (Custom Catchall) — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("Custom catchall canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Custom catchall/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
