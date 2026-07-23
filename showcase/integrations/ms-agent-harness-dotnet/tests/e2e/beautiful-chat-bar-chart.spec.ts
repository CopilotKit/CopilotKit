import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat bar chart", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Bar Chart pill renders recharts bars", async ({ page }) => {
    await clickBeautifulChatPill(page, "Bar Chart (Controlled Generative UI)");

    await expect(
      page.locator(".recharts-responsive-container").first(),
    ).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(async () => await page.locator(".recharts-bar-rectangle").count(), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(2);
  });
});
