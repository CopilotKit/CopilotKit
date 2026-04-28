import { test, expect } from "@playwright/test";

test.describe("BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("asking for a sales dashboard renders a json-render surface", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Show me the sales dashboard with a revenue bar chart.");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
