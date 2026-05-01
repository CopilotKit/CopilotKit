import { test, expect } from "@playwright/test";

test("agentic-chat: page loads and chat input is visible", async ({ page }) => {
  await page.goto("/demos/agentic-chat");
  await expect(
    page.getByRole("heading", { name: /agentic chat/i }),
  ).toBeVisible();
  // CopilotChat renders a textarea or input — relax to "any textbox"
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/agentic-chat");
  const pill = page.getByRole("button", { name: /Goldfish name/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
