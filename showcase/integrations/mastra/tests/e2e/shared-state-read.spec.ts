import { test, expect } from "@playwright/test";

import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner";
import {
  buildStateToolsTurns,
  STATE_TOOLS_ROUTES,
} from "../../../../harness/src/probes/scripts/_pill-contracts-state-tools";

// The canonical LGP contract is shared by every integration: no alternate prompt
// or framework-specific result can turn a failed actual pill into acceptance.
test("shared-state-read: every canonical pill dispatches its exact prompt and renders its exact result", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto(STATE_TOOLS_ROUTES["shared-state-read"]);
  const result = await runConversation(
    page,
    buildStateToolsTurns("shared-state-read"),
    { mode: "functional-pill", surface: "direct-diagnostic" },
  );
  expect(result.pillExecution?.completed, JSON.stringify(result)).toBe(true);
  expect(result.pillExecution?.actions).toHaveLength(3);
});

// Existing extra coverage remains executable, but is not canonical pill acceptance.
test.describe("diagnostic: existing integration regressions", () => {
  // Shared State (Reading) — Recipe Editor demo. The page publishes
  // `agent.state.recipe` via `agent.setState`; the agent reads (but does
  // not mutate) that recipe on every turn. Spec mirrors the QA contract
  // in qa/shared-state-read.md and the testids exposed by recipe-card.tsx.
  test.describe("Shared State (Reading)", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/demos/shared-state-read");
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
});
