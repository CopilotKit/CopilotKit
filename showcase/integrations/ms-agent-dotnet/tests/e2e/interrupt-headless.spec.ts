import { expect, test } from "@playwright/test";

test.describe("Interrupt Headless", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("cancelling the popup returns a denied response, not a booking confirmation", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Book an intro call with the sales team to discuss pricing.",
    );
    await input.press("Enter");

    const popup = page.locator('[data-testid="interrupt-headless-popup"]');
    await expect(popup).toBeVisible({ timeout: 60000 });
    await expect(popup.getByText(/Sales team/i)).toBeVisible();

    await page.getByTestId("interrupt-headless-cancel").click();

    await expect(popup).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByTestId("interrupt-headless-empty")).toBeVisible({
      timeout: 10000,
    });

    const assistantMessages = page.locator(
      '[data-testid="copilot-assistant-message"]',
    );
    await expect(
      assistantMessages
        .filter({ hasText: /Denied.*sales intro call|not booked/i })
        .first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      assistantMessages.filter({ hasText: /Booked.*Sales intro call/i }),
    ).toHaveCount(0);
  });
});
