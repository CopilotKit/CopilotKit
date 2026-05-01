import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen slot renders on first load", async ({ page }) => {
    const welcome = page.locator('[data-testid="custom-welcome-screen"]');
    await expect(welcome).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Welcome to the Slots demo" }),
    ).toBeVisible();

    await expect(welcome.getByText("Custom Slot")).toBeVisible();
  });

  test("canonical suggestion pill renders with the catalog title", async ({
    page,
  }) => {
    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Slot wiring" }),
    ).toBeVisible({ timeout: 15000 });
  });

  // Canonical e2e suggestion — single "Slot wiring" pill from
  // _canonical-catalog.json. Clicking it must surface the custom assistant
  // message slot, exercising the slot wiring this demo is built to verify.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Slot wiring" })
      .first()
      .click();

    const customMsg = page
      .locator('[data-testid="custom-assistant-message"]')
      .first();
    await expect(customMsg).toBeVisible({ timeout: 45000 });
  });

  test("custom disclaimer slot renders after the first user message", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });

    await expect(page.locator('[data-testid="custom-disclaimer"]')).toBeVisible(
      { timeout: 10000 },
    );
  });
});
