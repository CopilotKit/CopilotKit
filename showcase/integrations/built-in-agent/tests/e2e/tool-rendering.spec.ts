import { test, expect } from "@playwright/test";

test("tool-rendering: page loads and chat input is visible", async ({
  page,
}) => {
  await page.goto("/demos/tool-rendering");
  await expect(
    page.getByRole("heading", { name: /tool rendering/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/tool-rendering");
  const pill = page.getByRole("button", { name: /Pie chart/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-suggestion"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
