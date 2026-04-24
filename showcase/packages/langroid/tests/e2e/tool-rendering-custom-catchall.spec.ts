import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-custom-catchall.md
// Demo source: src/app/demos/tool-rendering-custom-catchall/page.tsx
//
// The page registers a single branded wildcard renderer via
// `useDefaultRenderTool`. Every Langroid backend tool call paints
// via the same CustomCatchallRenderer card.

test.describe("Tool Rendering — Custom Catch-all (Langroid)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("page loads with chat input and suggestion pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("weather prompt paints the custom catchall card", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in San Francisco?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const card = page
      .locator('[data-testid="custom-catchall-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: 60000 });

    await expect(
      card.locator('[data-testid="custom-catchall-tool-name"]'),
    ).toContainText("get_weather");
  });
});
