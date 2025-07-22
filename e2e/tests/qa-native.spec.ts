import { test, expect } from "@playwright/test";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";
const UI_URL = process.env.UI_URL || "http://localhost:3000";

test.describe("QA Native App", () => {
  test("agent health check", async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/docs`);
    expect(response.status()).toBe(200);
  });

  test("ui loads correctly", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page).toHaveTitle(/CopilotKit/);

    // Check for CopilotKit components
    await expect(page.locator('[data-testid="copilot-sidebar"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("copilot chat interaction", async ({ page }) => {
    await page.goto(UI_URL);

    // Wait for copilot to be ready
    await expect(page.locator('[data-testid="copilot-sidebar"]')).toBeVisible();

    // Open chat if not already open
    const chatButton = page.locator('[data-testid="copilot-toggle"]');
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    // Type a test message
    const chatInput = page.locator('[data-testid="copilot-input"]');
    await expect(chatInput).toBeVisible();
    await chatInput.fill("Hello, can you help me?");
    await chatInput.press("Enter");

    // Wait for response
    await expect(page.locator('[data-testid="copilot-message"]')).toBeVisible({
      timeout: 15000,
    });
  });
});
