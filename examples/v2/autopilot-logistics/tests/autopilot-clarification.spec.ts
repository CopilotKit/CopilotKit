import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("a live agent asks through the CopilotKit clarification slot and waits for a human answer", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const evidenceDir = evidencePath(
    "iteration-054",
    `clarification-${Date.now()}`,
  );
  mkdirSync(evidenceDir, { recursive: true });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(baseline.ok()).toBeTruthy();
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      "I may need help with either order NS-1001 or NS-1002, but I have not decided which one. Please use the clarification control to ask me which order I mean. Do not change either order.",
    );
  await page.locator(".assistant-panel button").last().click();
  const question = page.getByTestId("copilot-clarification");
  await expect(question).toBeVisible({ timeout: 100_000 });
  await expect(question).toContainText(/which|order/i);
  const questionText = await question.textContent();
  await page.screenshot({
    path: resolve(evidenceDir, "clarification.png"),
    fullPage: true,
  });
  await question.getByRole("textbox").fill("NS-1002");
  await question.getByRole("button", { name: "Send answer" }).click();
  await expect(question).toBeHidden({ timeout: 10_000 });
  let threadId = "";
  let messages: Array<{
    role: string;
    content?: string;
    toolCalls?: Array<{ name: string }>;
  }> = [];
  await expect
    .poll(
      async () => {
        const threads = await page.request.get(
          "/api/copilotkit/threads?agentId=logistics",
        );
        if (!threads.ok()) return false;
        threadId =
          (await threads.json()).threads.find(
            (thread: { id: string }) => !prior.has(thread.id),
          )?.id ?? "";
        if (!threadId) return false;
        const response = await page.request.get(
          `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
        );
        if (!response.ok()) return false;
        messages = (await response.json()).messages;
        return messages.some(
          (message) =>
            message.role === "tool" &&
            /"status"\s*:\s*"answered"/.test(message.content ?? ""),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(
    messages.some((message) =>
      message.toolCalls?.some((call) => call.name === "autopilot_askUser"),
    ),
  ).toBe(true);
  expect(
    messages.some(
      (message) =>
        message.role === "tool" &&
        /"answer"\s*:\s*"NS-1002"/.test(message.content ?? ""),
    ),
  ).toBe(true);
  writeFileSync(
    resolve(evidenceDir, "clarification.json"),
    JSON.stringify(
      { threadId, answer: "NS-1002", question: questionText },
      null,
      2,
    ),
  );
});
