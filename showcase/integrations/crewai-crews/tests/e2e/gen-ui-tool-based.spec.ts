import { test, expect } from "@playwright/test";

test.describe("Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("page loads with sidebar open", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("sidebar header shows Sales Pipeline title", async ({ page }) => {
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 10000,
    });
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Quarterly bars suggestion pill renders the bar chart", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Quarterly bars" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="bar-chart"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
