import { test, expect } from "@playwright/test";

test.describe("Tool Rendering Reasoning Chain (testing)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-reasoning-chain");
  });

  test("page renders without errors", async ({ page }) => {
    // Default CopilotChat input is the most stable structural element —
    // it renders as soon as the chat mounts, before any agent traffic.
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Kyoto itinerary/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
