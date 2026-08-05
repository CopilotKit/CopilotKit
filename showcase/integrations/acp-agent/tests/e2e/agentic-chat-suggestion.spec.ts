import { expect, test } from "@playwright/test";

test("agentic chat sends a starter suggestion", async ({ page }) => {
  await page.goto("/demos/agentic-chat");
  await page.getByRole("button", { name: "Tell me a joke" }).click();

  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 30_000 });
});
