import { test, expect } from "@playwright/test";

test.describe("BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("chat UI renders with suggestion pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // Suggestion pills appear as buttons once suggestions are configured.
    await expect(page.getByText("Sales dashboard").first()).toBeVisible();
  });
});
