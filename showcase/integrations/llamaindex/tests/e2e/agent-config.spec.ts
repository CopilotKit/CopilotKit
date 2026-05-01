import { test, expect } from "@playwright/test";

test.describe("Agent Config Object demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("page loads with chat input and config card", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sending a message returns an assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Explain webhooks in one sentence.");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });

  test("canonical 'Personalize tone' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
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
