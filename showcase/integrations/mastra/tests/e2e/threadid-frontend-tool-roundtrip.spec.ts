import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { buildChatPlatformTurns } from "../../../../harness/src/probes/scripts/_pill-contracts-chat-platform.js";
// Existing scenarios are diagnostics; only the canonical pill test below is functional acceptance.
import { test, expect } from "@playwright/test";

// QA reference: qa/threadid-frontend-tool-roundtrip.md
// Demo source: src/app/demos/threadid-frontend-tool-roundtrip/page.tsx
//
// The source-level regression for ENT-658 lives in react-core. This smoke keeps
// the showcase demo route and generated-thread toggle covered without depending
// on fixture-driven tool execution in the standalone showcase package.

test.describe("Diagnostic: Thread ID frontend-tool round trip", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/threadid-frontend-tool-roundtrip");
  });

  test("Diagnostic: page loads with generated-thread mode selected", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.getByLabel("Explicit threadId")).not.toBeChecked();
    await expect(page.getByTestId("ent-658-thread-mode")).toHaveText(
      /SDK-generated thread/i,
    );

    await page.getByLabel("Explicit threadId").check();
    await expect(page.getByTestId("ent-658-thread-mode")).toHaveText(
      /explicit thread/i,
    );
  });
});

test("Canonical pill acceptance: threadid-frontend-tool-roundtrip", async ({
  page,
}) => {
  await page.goto("/demos/threadid-frontend-tool-roundtrip");
  const result = await runConversation(
    page,
    buildChatPlatformTurns("threadid-frontend-tool-roundtrip"),
    { mode: "functional-pill", surface: "direct-diagnostic" },
  );
  expect(result.error, JSON.stringify(result.pillExecution)).toBeUndefined();
  expect(result.pillExecution?.completed).toBe(true);
});
