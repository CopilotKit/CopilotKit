import { test, expect } from "@playwright/test";

// Behavioral e2e for the gen-ui-agent demo (OpenClaw), run against aimock.
//
// This demo registers a per-tool renderer via `useRenderTool` for the
// `generate_recipe` tool (recipe-card.tsx). The card renders from the streamed
// tool ARGUMENTS, so the rich generative-UI component appears on the FIRST tool
// call — no tool-result round-trip is required. Stable testids:
//   data-testid="recipe-card"         (outer, with data-loading)
//   data-testid="recipe-title"
//   data-testid="recipe-ingredients" / "recipe-ingredient"
//   data-testid="recipe-steps"        / "recipe-step"
//
// The assertions target the rendered generative-UI component (by testid), not
// any specific LLM text.
test.describe("Agentic Generative UI (tool-call rendering)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-agent");
  });

  test("page loads with chat input and recipe suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of [
      "Weeknight pasta",
      "Vegan breakfast",
      "Chocolate dessert",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Weeknight pasta' pill renders a generative recipe card", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Weeknight pasta" }).click();

    // The per-tool renderer paints a rich recipe card from the tool arguments.
    const card = page.locator('[data-testid="recipe-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(card.locator('[data-testid="recipe-title"]')).toBeVisible();

    // The generative component renders the structured recipe data — at least
    // one ingredient and one step from the tool arguments.
    await expect(
      card.locator('[data-testid="recipe-ingredient"]').first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      card.locator('[data-testid="recipe-step"]').first(),
    ).toBeVisible();
  });

  test("typing a recipe prompt renders a generative recipe card", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Generate a quick weeknight pasta recipe.");
    await input.press("Enter");

    const card = page.locator('[data-testid="recipe-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(card.locator('[data-testid="recipe-title"]')).toBeVisible();
  });
});
