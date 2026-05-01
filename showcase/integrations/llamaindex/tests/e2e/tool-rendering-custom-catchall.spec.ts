import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Custom Catch-all)", () => {
  test("page loads with chat input", async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("weather query renders custom catchall card", async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in Tokyo?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="custom-catchall-card"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("canonical 'Custom catchall' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/tool-rendering-custom-catchall");
    const pill = page.getByRole("button", { name: /Custom catchall/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="custom-catchall-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
