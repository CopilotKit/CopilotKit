import { test, expect } from "@playwright/test";

test("subagents: page loads and chat input is visible", async ({ page }) => {
  await page.goto("/demos/subagents");
  await expect(
    page.getByRole("heading", { name: /sub-agents/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/subagents");
  const pill = page.getByRole("button", { name: /Research draft/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
