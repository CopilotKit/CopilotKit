import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test("page loads with chat input", async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
  });

  // Canonical e2e suggestion — single "Async metric" pill from
  // _canonical-catalog.json. The async frontend tool resolves and the
  // assistant message becomes visible. Selector falls back to
  // [data-role="assistant"] (ag2 spec convention) instead of the
  // catalog's notes-card observable.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/frontend-tools-async");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Async metric" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });
});
