import { test, expect } from "@playwright/test";

test.describe("BYOC Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("asking for a Q4 summary renders a hashbrown dashboard", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Give me a Q4 sales summary with metrics and charts.");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("canonical 'Sales overview' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
