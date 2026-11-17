// The Calculator narration ("Calculator app rendered above") is fixture text.
// The Excalidraw test needs the demo's runtime to serve MCP Apps, which its
// GET /info reports as `mcpAppsEnabled`, and the MCP server at MCP_SERVER_URL
// to answer. It checks the app itself: the MCP Apps middleware runs the
// create_view call after the agent's run, so no narration follows it.
import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";
import { describeDemo, integration } from "./helpers";

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
    const info = await page.request.get(
      `/api/${integration}/beautiful-chat/info`,
    );
    expect(info.ok()).toBeTruthy();
    const { mcpAppsEnabled }: { mcpAppsEnabled?: boolean } = await info.json();
    test.skip(
      mcpAppsEnabled !== true,
      `The ${integration} beautiful-chat runtime serves no MCP Apps.`,
    );

    await clickBeautifulChatPill(page, "Excalidraw Diagram (MCP App)");

    await expect(page.getByText("create_view").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("iframe").first()).toBeVisible({
      timeout: 60_000,
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
