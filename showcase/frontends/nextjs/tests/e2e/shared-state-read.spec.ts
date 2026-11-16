import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Shared State (Reading): the Recipe Editor demo. The page publishes
// `agent.state.recipe` with `agent.setState`, and the agent reads (but does
// not change) that recipe on every turn. The test ids come from
// recipe-card.tsx.
describeDemo("shared-state-read", "Shared State (Reading)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("shared-state-read"));
  });

  test("recipe card loads with default ingredients and the sidebar mounts", async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="recipe-card"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("AI Recipe Assistant")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator('[data-testid="ingredients-container"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="instructions-container"]'),
    ).toBeVisible();
  });

  test("starter suggestions render", async ({ page }) => {
    for (const title of [
      "Create Italian recipe",
      "Make it healthier",
      "Suggest variations",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("clicking 'Add Ingredient' appends a new ingredient-card row", async ({
    page,
  }) => {
    const ingredientCards = page.locator('[data-testid="ingredient-card"]');
    const initialCount = await ingredientCards.count();
    await page.locator('[data-testid="add-ingredient-button"]').click();
    await expect(ingredientCards).toHaveCount(initialCount + 1, {
      timeout: 5000,
    });
  });

  test("sending a sidebar message returns an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What recipe am I making?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
