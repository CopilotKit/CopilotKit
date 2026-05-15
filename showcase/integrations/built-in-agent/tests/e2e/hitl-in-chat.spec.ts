import { test, expect } from "@playwright/test";

test("hitl-in-chat: page loads and chat input is visible", async ({ page }) => {
  await page.goto("/demos/hitl");
  await expect(
    page.getByRole("heading", { name: /human in the loop/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});
