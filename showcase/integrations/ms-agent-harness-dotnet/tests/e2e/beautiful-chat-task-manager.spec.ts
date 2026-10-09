import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat shared state", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Task Manager pill streams todos into the app canvas", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Task Manager (Shared State)");

    await expect(
      page.locator('section[aria-label="To Do column"]'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Read the CopilotKit docs")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Build a CopilotKit prototype")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Explore shared agent state")).toBeVisible({
      timeout: 5_000,
    });
  });
});
