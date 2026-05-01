import { test, expect } from "@playwright/test";

test.describe("Agent Config Object", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("page loads with config card and default dropdown values", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Agent Config Object" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-card"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-tone-select"]'),
    ).toHaveValue("professional");
    await expect(
      page.locator('[data-testid="agent-config-expertise-select"]'),
    ).toHaveValue("intermediate");
    await expect(
      page.locator('[data-testid="agent-config-length-select"]'),
    ).toHaveValue("concise");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("changing a dropdown updates its DOM value immediately", async ({
    page,
  }) => {
    const toneSelect = page.locator('[data-testid="agent-config-tone-select"]');
    await toneSelect.selectOption("enthusiastic");
    await expect(toneSelect).toHaveValue("enthusiastic");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
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
