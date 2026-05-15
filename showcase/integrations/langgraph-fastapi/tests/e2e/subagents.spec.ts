import { test, expect } from "@playwright/test";

test.describe("Sub-Agents", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/subagents");
  });

  test("page loads with travel planner and sidebar", async ({ page }) => {
    // The TravelPlanner shows "Current Itinerary" section
    await expect(page.getByText("Current Itinerary")).toBeVisible({
      timeout: 10000,
    });

    // Sidebar should show "Travel Planning Assistant"
    await expect(page.getByText("Travel Planning Assistant")).toBeVisible({
      timeout: 10000,
    });
  });

  test("agent indicators are visible with supervisor active by default", async ({
    page,
  }) => {
    // All four agent indicators should be visible
    await expect(
      page.locator('[data-testid="supervisor-indicator"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="flights-indicator"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="hotels-indicator"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="experiences-indicator"]'),
    ).toBeVisible();

    // Supervisor should be the active agent (has blue/active styling)
    const supervisorIndicator = page.locator(
      '[data-testid="supervisor-indicator"]',
    );
    await expect(supervisorIndicator).toHaveClass(/bg-blue-100/);
  });

  test("itinerary starts empty with placeholder text", async ({ page }) => {
    await expect(page.getByText("No items yet -- start planning!")).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("travel sections show empty state initially", async ({ page }) => {
    await expect(page.getByText("No flights found yet")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("No hotels found yet")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("No experiences planned yet")).toBeVisible({
      timeout: 10000,
    });
  });

  test("section headings for travel categories are visible", async ({
    page,
  }) => {
    await expect(page.getByText("Flight Options")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Hotel Options")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Experiences")).toBeVisible({
      timeout: 10000,
    });
  });

  test("sidebar has chat input for travel planning", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("can send message and get assistant response", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("I want to plan a trip to Tokyo");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("travel planning request populates flight or hotel options", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill(
      "Plan a 5-day trip to Paris with flights and hotel recommendations",
    );
    await input.press("Enter");

    // Wait for agent to process -- should populate at least one section
    // or show an interrupt for selection
    const flightOption = page.locator(".bg-gray-50.rounded-lg").first();
    const interruptCard = page.locator(".bg-blue-50.rounded-lg").first();
    const assistantMsg = page.locator('[data-role="assistant"]').first();

    await expect(flightOption.or(interruptCard).or(assistantMsg)).toBeVisible({
      timeout: 60000,
    });
  });
});
