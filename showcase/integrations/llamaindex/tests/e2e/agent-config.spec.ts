import { test, expect } from "@playwright/test";

test.describe("Agent Config Object demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("page loads with chat input and config card", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sending a message returns an assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Explain webhooks in one sentence.");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });
});
