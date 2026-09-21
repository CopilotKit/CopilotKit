import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { attachSseInterceptor } from "../../../../harness/src/probes/helpers/sse-interceptor.js";
import { buildTurns } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-schedule-meeting.js";
import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat app surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("[diagnostic supplemental] Excalidraw pill renders the MCP app result", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Excalidraw Diagram (MCP App)");

    await expect(
      page.getByText(/Network diagram drawn above/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("iframe").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("[diagnostic supplemental] Calculator pill renders the sandboxed Open Generative UI app", async ({
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

test("beautiful-chat-schedule-meeting canonical actual pill", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const capture = await attachSseInterceptor(page);
  try {
    await page.goto("/demos/beautiful-chat");
    const result = await runConversation(
      page,
      buildTurns({
        integrationSlug: "ms-agent-harness-dotnet",
        featureType: "beautiful-chat-schedule-meeting",
        baseUrl: new URL(page.url()).origin,
      }),
      { mode: "functional-pill" },
    );
    expect(result.error).toBeUndefined();
    expect(result.pillExecution?.completed).toBe(true);
    expect(result.pillExecution?.actions).toHaveLength(9);
  } finally {
    await capture.stop();
  }
});
