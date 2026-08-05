import { expect, test } from "@playwright/test";

test("agentic chat keeps context across turns", async ({ page }) => {
  await page.goto("/demos/agentic-chat");

  const input = page.getByPlaceholder("Type a message");
  await input.fill("My name is Alice.");
  await input.press("Enter");
  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Write a sonnet" }),
  ).toBeVisible({ timeout: 10_000 });

  await input.fill("What name did I just give you?");
  await input.press("Enter");

  const responses = page.locator('[data-testid="copilot-assistant-message"]');
  await expect(responses.nth(1)).toContainText(/Alice/i, { timeout: 30_000 });
});
