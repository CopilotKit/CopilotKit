import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat pie chart", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Pie Chart pill renders controlled generative UI", async ({ page }) => {
    await clickBeautifulChatPill(page, "Pie Chart (Controlled Generative UI)");

    const circles = page.locator("svg circle");
    await expect
      .poll(async () => await circles.count(), { timeout: 45_000 })
      .toBeGreaterThanOrEqual(3);
    await expect(page.getByText(/\d+%/).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
