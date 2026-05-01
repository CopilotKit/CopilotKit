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

    // Demo-specific suggestions were collapsed to the single canonical pill
    // (see showcase/aimock/_canonical-catalog.json) so the e2e fixture
    // remains substring-disjoint with every other demo.
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Default catchall" }).first(),
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

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Default catchall/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // Catalog primarySelector is [data-testid="custom-catchall-card"], but
    // langroid's default-catchall renderer paints via the built-in card
    // (no testid). Fall back to [data-role="assistant"].
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
