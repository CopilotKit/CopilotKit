import { test, expect } from "@playwright/test";

// E2E for the hitl-in-chat demo — exercises the canonical suggestion pill
// registered by `useConfigureSuggestions` in page.tsx.
//
// Note: tests/e2e/hitl-in-chat.spec.ts is misnamed in this column — it
// actually targets /demos/hitl. This file is the real /demos/hitl-in-chat
// canonical coverage.

test.describe("HITL (In-Chat)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Pick a slot/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="time-picker-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
