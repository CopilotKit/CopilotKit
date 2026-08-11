import { test, expect } from "@playwright/test";

// Behavioral e2e for the shared-state-read demo (OpenClaw), run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so these
// prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// This is the Recipe Editor "read-only shared state" demo. The page publishes
// `agent.state.recipe` via `agent.setState` (seeded with INITIAL_RECIPE) and
// the agent READS that recipe on every turn but never mutates it — there is no
// backend tool and no frontend tool. So unlike frontend-tools, there is NO
// tool-call loop and NO "returned:" terminator fixture: every turn is a plain
// text response keyed on a userMessage substring.
//
// The recipe card (data-testid="recipe-card") is a controlled form on top of
// agent state; the CopilotSidebar (header "AI Recipe Assistant", input
// placeholder "Type a message") drives the conversation. The default recipe is
// titled "Make Your Recipe" with Carrots + All-Purpose Flour — the fixture
// responses reference those default values so the fixture demonstrably drives
// the rendered run.
test.describe("Shared State (Reading)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read");
  });

  test("recipe card loads with default ingredients and the sidebar mounts", async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="recipe-card"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("AI Recipe Assistant")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="ingredients-container"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="instructions-container"]'),
    ).toBeVisible();
    // Default recipe seeded into agent state via agent.setState(INITIAL_RECIPE).
    await expect(page.locator('[data-testid="ingredient-card"]')).toHaveCount(
      2,
      { timeout: 15000 },
    );
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
    await expect(ingredientCards).toHaveCount(2, { timeout: 15000 });
    await page.locator('[data-testid="add-ingredient-button"]').click();
    await expect(ingredientCards).toHaveCount(3, { timeout: 5000 });
  });

  test("agent reads the recipe title from shared state", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What recipe am I making right now?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    // Fixture response echoes the default title from agent.state.recipe.
    await expect(page.getByText(/Make Your Recipe/i).last()).toBeVisible({
      timeout: 30000,
    });
  });

  test("agent reads the current ingredient list from shared state", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("List my current ingredients.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    // Fixture response references the two default ingredients in shared state.
    await expect(page.getByText(/Carrots/i).last()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/All-Purpose Flour/i).last()).toBeVisible({
      timeout: 30000,
    });
  });
});
