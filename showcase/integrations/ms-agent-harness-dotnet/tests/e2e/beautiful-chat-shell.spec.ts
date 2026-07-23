import { expect, test } from "@playwright/test";
import {
  beautifulChatPills,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat shell", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("loads the chat frame and app mode controls", async ({ page }) => {
    await expect(page.locator('img[alt="CopilotKit"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Chat", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "App", exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("renders all Beautiful Chat suggestion pills", async ({ page }) => {
    for (const title of beautifulChatPills) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
