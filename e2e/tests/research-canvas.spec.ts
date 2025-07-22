import { test, expect } from "@playwright/test";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8006";
const UI_URL = process.env.UI_URL || "http://localhost:3006";

test.describe("Research Canvas App", () => {
  test("agent health check", async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/docs`);
    expect(response.status()).toBe(200);
  });

  test("ui loads correctly", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page).toHaveTitle(/Research Canvas|CopilotKit/);

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Check for basic page structure
    await expect(page.locator("body")).toBeVisible();
  });

  test.skip("research functionality - requires UI implementation", async ({
    page,
  }) => {
    // Placeholder for when UI research features are implemented
    await page.goto(UI_URL);
    // Add tests for research canvas specific features
  });
});
