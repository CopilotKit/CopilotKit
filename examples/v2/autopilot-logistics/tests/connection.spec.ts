import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live Intelligence agent calls a frontend tool", async ({ page }) => {
  const evidenceRoot =
    process.env.AUTOPILOT_EVIDENCE_DIR || evidencePath("iteration-002");
  const evidenceDir = resolve(
    evidenceRoot,
    process.env.AUTOPILOT_TRIAL_ID || String(Date.now()),
  );
  mkdirSync(evidenceDir, { recursive: true });

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.screenshot({
    path: resolve(evidenceDir, "dashboard.png"),
    fullPage: true,
  });

  const infoResponse = await page.request.get("/api/copilotkit/info");
  expect(infoResponse.ok()).toBeTruthy();
  const info = await infoResponse.json();
  expect(info.mode).toBe("intelligence");
  expect(info.agents.logistics).toBeTruthy();
  expect(info.autopilot).toEqual({ enabled: true });

  const input = page.locator(".assistant-panel textarea").last();
  await expect(input).toBeVisible();
  await input.fill(
    "Use describeVisiblePage to read this screen in my browser, then tell me its title and path.",
  );
  await input.press("Enter");
  await expect(page.locator(".assistant-panel")).toContainText("Dashboard", {
    timeout: 60_000,
  });
  await page.screenshot({
    path: resolve(evidenceDir, "tool-round-trip.png"),
    fullPage: true,
  });

  const threadsResponse = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(threadsResponse.ok()).toBeTruthy();
  const threads = await threadsResponse.json();
  const threadId: string = threads.threads[0]?.id;
  expect(threadId).toBeTruthy();
  let messages: Array<{
    role: string;
    content: string;
    toolCalls?: Array<{ name: string }>;
  }> = [];
  await expect
    .poll(
      async () => {
        const messagesResponse = await page.request.get(
          `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
        );
        if (!messagesResponse.ok()) return false;
        messages = (await messagesResponse.json()).messages;
        return (
          messages.length === 4 && messages[3]?.content.includes("Dashboard")
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(messages.map((message: { role: string }) => message.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
  ]);
  expect(messages[1].toolCalls?.[0]?.name).toBe("describeVisiblePage");
  expect(messages[2].content).toContain('"title":"Dashboard"');
  expect(messages[3].content).toContain("Dashboard");
  await page.reload();
  const restoredResponse = await page.request.get(
    `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
  );
  expect(restoredResponse.ok()).toBeTruthy();
  expect((await restoredResponse.json()).messages).toHaveLength(4);
  writeFileSync(
    resolve(evidenceDir, "connection.json"),
    JSON.stringify(
      {
        mode: info.mode,
        agents: Object.keys(info.agents),
        threadId,
        roles: messages.map((message: { role: string }) => message.role),
        toolName: messages[1].toolCalls?.[0]?.name,
        toolResult: messages[2].content,
        restoredMessageCount: 4,
        assistantText: messages[3].content,
      },
      null,
      2,
    ),
  );
});
