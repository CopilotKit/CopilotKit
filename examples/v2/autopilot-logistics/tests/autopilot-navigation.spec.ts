import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live agent navigates to Users and back with app router", async ({
  page,
}) => {
  const browserEvents: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      browserEvents.push(`frame:${new URL(frame.url()).pathname}`);
  });
  page.on("request", (request) => {
    if (request.resourceType() === "document")
      browserEvents.push(`document:${new URL(request.url()).pathname}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      browserEvents.push(`console:${message.text().slice(0, 200)}`);
  });
  const evidenceDir = resolve(
    process.cwd(),
    "../../../.context/autopilot-evidence/iteration-009",
    String(Date.now()),
  );
  mkdirSync(evidenceDir, { recursive: true });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(baseline.ok()).toBeTruthy();
  const before = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      "Use autopilot_navigate to visit the Users section, then autopilot_goBack to return to Dashboard. Report the pages you actually visited.",
    );
  await page.locator(".assistant-panel button").last().click();
  let threadId = "";
  let messages: Array<{
    role: string;
    content?: string;
    toolCalls?: Array<{ name: string }>;
  }> = [];
  try {
    await expect
      .poll(
        async () => {
          const threads = await page.request.get(
            "/api/copilotkit/threads?agentId=logistics",
          );
          if (!threads.ok()) return false;
          threadId =
            (await threads.json()).threads.find(
              (thread: { id: string }) => !before.has(thread.id),
            )?.id ?? "";
          if (!threadId) return false;
          const response = await page.request.get(
            `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
          );
          if (!response.ok()) return false;
          messages = (await response.json()).messages;
          const calls = messages
            .flatMap((message) => message.toolCalls ?? [])
            .map((call) => call.name);
          const results = messages
            .filter((message) => message.role === "tool")
            .map((message) => message.content ?? "");
          return (
            calls.includes("autopilot_navigate") &&
            calls.includes("autopilot_goBack") &&
            results.some(
              (result) =>
                result.includes('"path":"/users"') &&
                result.includes('"status":"arrived"'),
            ) &&
            results.some(
              (result) =>
                result.includes('"path":"/"') &&
                result.includes('"status":"arrived"'),
            )
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  } finally {
    writeFileSync(
      resolve(evidenceDir, "diagnostic.json"),
      JSON.stringify(
        {
          threadId,
          currentPath: new URL(page.url()).pathname,
          events: browserEvents,
          messages: messages.map((message) => ({
            role: message.role,
            tools: message.toolCalls?.map((call) => call.name),
            result:
              message.role === "tool"
                ? (message.content ?? "").slice(0, 200)
                : undefined,
          })),
        },
        null,
        2,
      ),
    );
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.screenshot({
    path: resolve(evidenceDir, "navigated-back.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "navigation.json"),
    JSON.stringify(
      {
        threadId,
        toolSequence: messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name),
        resultPaths: messages
          .filter((message) => message.role === "tool")
          .map((message) => {
            try {
              const result = JSON.parse(message.content ?? "");
              return { status: result.status, path: result.path };
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      },
      null,
      2,
    ),
  );
});
