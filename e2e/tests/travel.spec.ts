import { test, expect } from "@playwright/test";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8007";
const UI_URL = process.env.UI_URL || "http://localhost:3007";

test.describe("Travel App", () => {
  test("agent health check", async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/docs`);
    expect(response.status()).toBe(200);
  });

  test("ui loads correctly", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page).toHaveTitle(/Travel|CopilotKit/);

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Check for basic page structure
    await expect(page.locator("body")).toBeVisible();
  });

  test.skip("travel planning - requires Google Maps API", async ({ page }) => {
    // Placeholder for when Google Maps integration is properly configured
    await page.goto(UI_URL);
    // Add tests for travel planning features
  });
});
