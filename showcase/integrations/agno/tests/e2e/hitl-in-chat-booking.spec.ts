import { test, expect } from "@playwright/test";

test.describe("In-Chat HITL (Booking)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
  });

  test("clicking the book-a-call pill renders the time picker", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Book a call with sales" })
      .first()
      .click();

    await expect(
      page.locator('[data-testid="time-picker-card"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("picking a time slot resolves the HITL tool and shows confirmation", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Book a call with sales" })
      .first()
      .click();

    const card = page.locator('[data-testid="time-picker-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });

    // Pick the first slot button (the four rendered slot buttons).
    await card.locator("button").first().click();

    await expect(
      page.locator('[data-testid="time-picker-picked"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
