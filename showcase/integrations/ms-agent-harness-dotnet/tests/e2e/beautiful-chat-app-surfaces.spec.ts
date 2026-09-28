import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat app surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Schedule Meeting pill resumes after selecting a time", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Schedule Meeting (Human In The Loop)");
    await page.getByRole("button", { name: /Tomorrow/ }).click({
      timeout: 60_000,
    });

    await expect(page.getByText("Meeting Scheduled")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Tomorrow at 2:00 PM")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Excalidraw pill renders the MCP app result", async ({ page }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Excalidraw Diagram (MCP App)");

    await expect(
      page.getByText(/Network diagram drawn above/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("iframe").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Calculator pill renders the sandboxed Open Generative UI app", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Calculator App (Open Generative UI)");

    await expect(
      page.getByText(/Calculator app rendered above/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("iframe").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
