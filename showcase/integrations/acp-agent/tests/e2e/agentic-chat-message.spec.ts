import { expect, test } from "@playwright/test";

test("agentic chat returns a response to typed input", async ({ page }) => {
  await page.goto("/demos/agentic-chat");

  const input = page.getByPlaceholder("Type a message");
  await input.fill("Say hello in one word.");
  await input.press("Enter");

  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 30_000 });
});
