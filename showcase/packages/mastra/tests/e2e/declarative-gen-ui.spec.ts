import { test, expect } from "@playwright/test";

test.describe("Declarative Generative UI (A2UI — Dynamic Schema)", () => {
  test("chat surface + suggestion chips render", async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
    // Suggestion chips are rendered by useConfigureSuggestions; the dynamic
    // A2UI surface only renders after a turn lands, so this smoke test
    // limits itself to the chrome that is guaranteed on page-load.
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(
      page.getByText(/Show a KPI dashboard|Pie chart|Bar chart/).first(),
    ).toBeVisible();
  });
});
