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

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Write a sonnet" }),
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Tell me a joke" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('clicking "Tell me a joke" shows the custom assistant message slot', async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Tell me a joke" })
      .first()
      .click();

    const customMsg = page
      .locator('[data-testid="custom-assistant-message"]')
      .first();
    await expect(customMsg).toBeVisible({ timeout: 45000 });

    await expect(customMsg.getByText("slot", { exact: true })).toBeVisible();
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
