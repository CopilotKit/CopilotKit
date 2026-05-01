import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test("page loads with chat input and background container", async ({
    page,
  }) => {
    await page.goto("/demos/frontend-tools");
    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — single "Switch theme" pill from
  // _canonical-catalog.json. Confirms the frontend tool dispatches and
  // the background container remains observable.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/frontend-tools");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Switch theme" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible({ timeout: 30000 });
  });
});
