import { test, expect } from "@playwright/test";

test.describe("Agent Config", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("renders config card with three selects", async ({ page }) => {
    await expect(
      page.locator('[data-testid="agent-config-card"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-tone-select"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-expertise-select"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-length-select"]'),
    ).toBeVisible();
  });

  test("updating a select does not break the chat", async ({ page }) => {
    const tone = page.locator('[data-testid="agent-config-tone-select"]');
    await tone.selectOption("casual");
    await expect(tone).toHaveValue("casual");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
