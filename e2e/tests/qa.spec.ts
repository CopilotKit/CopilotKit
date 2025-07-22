import { test, expect } from "@playwright/test";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8003";
const UI_URL = process.env.UI_URL || "http://localhost:3003";

test.describe("QA App", () => {
  test("agent health check", async ({ request }) => {
    const response = await request.post(`${AGENT_URL}/copilotkit/info`);
    expect(response.status()).toBe(200);
  });

  test("ui loads correctly", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page).toHaveTitle(/CopilotKit/);

    // Wait for page to load
    await page.waitForLoadState("networkidle");
  });

  test.skip("copilot interaction - requires real UI implementation", async ({
    page,
  }) => {
    // Placeholder for when UI is actually implemented
    await page.goto(UI_URL);
    // Add specific tests based on actual UI components
  });
});
