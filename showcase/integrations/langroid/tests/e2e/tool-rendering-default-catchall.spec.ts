import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-default-catchall.md
// Demo source: src/app/demos/tool-rendering-default-catchall/page.tsx
//
// The page registers CopilotKit's built-in DefaultToolCallRenderer as
// the `*` wildcard via `useDefaultRenderTool()` with no config. The
// Langroid backend exposes `get_weather`, `search_flights`, etc., and
// every tool call must paint via this one built-in card.

test.describe("Tool Rendering — Default Catch-all (Langroid)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page loads with chat input and suggestion pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Weather in SF" }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      suggestions.filter({ hasText: "Find flights" }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      suggestions.filter({ hasText: "Weather in Tokyo" }).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test("weather prompt paints the built-in default tool-call card", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in San Francisco?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.getByText("get_weather", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });

    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 60000,
    });

    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
  });
});
