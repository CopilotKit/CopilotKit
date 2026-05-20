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
