import { test, expect } from "@playwright/test";
import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { attachSseInterceptor } from "../../../../harness/src/probes/helpers/sse-interceptor.js";
import { buildTurns } from "../../../../harness/src/probes/scripts/d5-headless-simple.js";

// The shared canonical builder certifies every actual control and rendered value.
// Independent empty-state controls use fresh scenarios; no prompt is typed.
test("headless-simple: all canonical pills and exact visible outcomes", async ({
  page,
}) => {
  test.setTimeout(240000);
  const capture = await attachSseInterceptor(page);
  try {
    await page.goto("/demos/headless-simple");
    const result = await runConversation(
      page,
      buildTurns({
        integrationSlug: "ms-agent-python",
        featureType: "headless-simple",
        baseUrl: new URL(page.url()).origin,
      }),
      { mode: "functional-pill" },
    );
    expect(result.error).toBeUndefined();
    expect(result.pillExecution?.completed).toBe(true);
    expect(result.pillExecution?.actions).toHaveLength(3);
  } finally {
    await capture.stop();
  }
});
