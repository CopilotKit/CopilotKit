import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat frontend tool", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Toggle Theme pill flips the html dark class", async ({ page }) => {
    const html = page.locator("html");
    const initialClass = (await html.getAttribute("class")) ?? "";
    const initiallyDark = initialClass.includes("dark");

    await clickBeautifulChatPill(page, "Toggle Theme (Frontend Tools)");

    await expect
      .poll(
        async () => {
          const cls = (await html.getAttribute("class")) ?? "";
          return cls.includes("dark");
        },
        { timeout: 30_000 },
      )
      .toBe(!initiallyDark);
  });
});
