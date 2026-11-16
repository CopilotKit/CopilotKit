// The narration lines checked here ("Network diagram drawn above",
// "Calculator app rendered above") are fixture text. The Excalidraw test also
// needs the integration's runtime to serve MCP Apps, and the MCP server at
// MCP_SERVER_URL to answer.
import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";
import { describeDemo } from "./helpers";

describeDemo("beautiful-chat", "Beautiful Chat app surfaces", () => {
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
