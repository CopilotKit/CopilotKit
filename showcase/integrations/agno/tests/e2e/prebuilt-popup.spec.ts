import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with heading and the popup open by default", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", {
        name: "Popup demo — look for the floating launcher",
      }),
    ).toBeVisible();

    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();

    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — single "Popup hello" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and produces an assistant response inside the popup.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Popup hello" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });

    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Ask the popup anything...");
    await input.fill("Hello");

    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("popup close button hides the popup; launcher re-mounts it", async ({
    page,
  }) => {
    const popup = page.locator('[data-testid="copilot-popup"]');
    await expect(popup).toBeVisible();

    await page.locator('[data-testid="copilot-close-button"]').first().click();
    await expect(popup).toBeHidden({ timeout: 10000 });

    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(popup).toBeVisible({ timeout: 10000 });

    await expect(page).toHaveURL(/\/demos\/prebuilt-popup$/);
  });
});
