import { expect, test } from "@playwright/test";

test.describe("reasoning default", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default");
  });

  test("renders the chat input", async ({ page }) => {
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
  });

  test("renders a reasoning message", async ({ page }) => {
    const suggestion = page
      .getByRole("button", { name: /Show reasoning/i })
      .first();
    await expect(suggestion).toBeVisible({ timeout: 30_000 });
    await suggestion.click();

    await expect(page.getByText(/Thinking…|Thought for/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
