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
