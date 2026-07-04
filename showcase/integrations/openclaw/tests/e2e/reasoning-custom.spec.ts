import { test, expect } from "@playwright/test";

// Behavioral e2e for the reasoning-custom demo, run against aimock (deterministic
// LLM). The OpenClaw gateway injects X-AIMock-Context: openclaw, so these prompts
// match the fixtures in showcase/aimock/d4/openclaw/chat.json. The reasoning
// fixtures carry a `reasoning` field so REASONING_* events stream and the custom
// `ReasoningBlock` slot ([data-testid="reasoning-block"]) has content to render.
test.describe("Reasoning (Custom)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-custom");
  });

  test("page loads with a chat input and the starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["Show reasoning", "Plan a trip", "Is 17 prime?"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("clicking 'Show reasoning' renders the custom reasoning block and an answer", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Show reasoning" }).click();

    // The custom reasoningMessage slot renders the reasoning chain.
    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 30000 });

    // The assistant's final answer still streams alongside the reasoning block.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    // The sky-scattering fixture answer mentions Rayleigh scattering.
    await expect(page.getByText(/scatter/i).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("typing a reasoning prompt renders the custom reasoning block", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill(
      "Plan a 3-day trip to Tokyo, reasoning through the trade-offs at each step.",
    );
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
