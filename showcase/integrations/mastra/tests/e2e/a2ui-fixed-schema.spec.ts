import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed Schema", () => {
  test("chat surface + canonical suggestion pill renders", async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByText(/Block calendar/).first()).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
    const pill = page.getByRole("button", { name: /Block calendar/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
