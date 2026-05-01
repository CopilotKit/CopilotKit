import { test, expect } from "@playwright/test";

test.describe("Agent Config", () => {
  test("config card renders", async ({ page }) => {
    await page.goto("/demos/agent-config");
    await expect(
      page.getByRole("heading", { name: /Agent Config/i }),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/agent-config");
    const pill = page
      .getByRole("button", { name: /Personalize tone/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="agent-config-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
