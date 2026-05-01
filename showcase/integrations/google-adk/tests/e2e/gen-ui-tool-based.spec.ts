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

  // Canonical e2e suggestion pill — message must match
  // showcase/aimock/_canonical-catalog.json (frozen) for gen-ui-tool-based.
  test("Quarterly bars suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Quarterly bars/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText(
        "render a tool-based bar chart for last quarter deliveries",
      ),
    ).toBeVisible({ timeout: 30_000 });
  });
});
