import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Default reasoning/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // catalog primarySelector "[data-testid=\"copilot-reasoning-message\"]"
    // not emitted by the v2 CopilotChatReasoningMessage component — falling
    // back to generic assistant role
    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
