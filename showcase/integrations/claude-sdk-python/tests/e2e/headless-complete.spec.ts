import { test, expect } from "@playwright/test";
import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { attachSseInterceptor } from "../../../../harness/src/probes/helpers/sse-interceptor.js";
import { buildTurns } from "../../../../harness/src/probes/scripts/d5-gen-ui-headless-complete.js";

// The shared canonical builder certifies every actual control and rendered value.
// Independent empty-state controls use fresh scenarios; no prompt is typed.
test("gen-ui-headless-complete: all canonical pills and exact visible outcomes", async ({
  page,
}) => {
  test.setTimeout(600000);
  const capture = await attachSseInterceptor(page);
  try {
    await page.goto("/demos/headless-complete");
    const result = await runConversation(
      page,
      buildTurns({
        integrationSlug: "claude-sdk-python",
        featureType: "gen-ui-headless-complete",
        baseUrl: new URL(page.url()).origin,
      }),
      { mode: "functional-pill" },
    );
    expect(result.error).toBeUndefined();
    expect(result.pillExecution?.completed).toBe(true);
    expect(result.pillExecution?.actions).toHaveLength(8);
  } finally {
    await capture.stop();
  }
});
