import { test, expect } from "@playwright/test";

// E2E for the shared-state-read-write demo. Scope: load the page and exercise
// the canonical suggestion pill registered by `useConfigureSuggestions` in
// page.tsx. The pill matches the entry in showcase/aimock/_canonical-catalog.json,
// so a single click drives the feature deterministically against aimock.

test.describe("Shared State (Read+Write)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(
      page.locator('[data-testid="copilot-chat-input"]').first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
