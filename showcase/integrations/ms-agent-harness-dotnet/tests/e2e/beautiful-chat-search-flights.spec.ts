import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { attachSseInterceptor } from "../../../../harness/src/probes/helpers/sse-interceptor.js";
import { buildTurns } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-search-flights.js";
import { expect, test } from "@playwright/test";
test("beautiful-chat-search-flights canonical actual pill", async ({
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
        featureType: "beautiful-chat-search-flights",
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
