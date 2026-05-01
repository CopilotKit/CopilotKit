import { test, expect } from "@playwright/test";

test.describe("Shared State (Read + Write)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
  });

  test("page loads with chat input and preferences card", async ({ page }) => {
    await expect(page.getByPlaceholder("Chat with the agent...")).toBeVisible();
  });

  test("canonical 'Weekend plan' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
