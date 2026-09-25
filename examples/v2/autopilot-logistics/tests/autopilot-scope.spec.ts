import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type StoredMessage = {
  role: string;
  content: string;
  toolCalls?: Array<{ name: string }>;
};

for (const trial of [
  { mode: "Off", agent: "Logistics", expectAutopilot: false },
  { mode: "Logistics only", agent: "Operations", expectAutopilot: false },
  { mode: "Logistics only", agent: "Logistics", expectAutopilot: true },
  { mode: "All agents", agent: "Operations", expectAutopilot: true },
] as const) {
  test(`live Autopilot scope: ${trial.mode} / ${trial.agent}`, async ({
    page,
  }) => {
    const evidenceDir = evidencePath(
      "iteration-022",
      `${Date.now()}-${trial.mode.replaceAll(" ", "-")}-${trial.agent}`,
    );
    mkdirSync(evidenceDir, { recursive: true });
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Avery Morgan/ }).click();
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();

    const infoResponse = await page.request.get("/api/copilotkit/info");
    expect(infoResponse.ok()).toBeTruthy();
    const info = await infoResponse.json();
    expect(Object.keys(info.agents).sort()).toEqual([
      "logistics",
      "operations",
    ]);
    expect(info.autopilot).toEqual({ enabled: true });

    await page
      .getByRole("combobox", { name: "Autopilot scope" })
      .selectOption({ label: trial.mode });
    await page
      .getByRole("combobox", { name: "Assistant agent" })
      .selectOption({ label: trial.agent });
    const agentId = trial.agent.toLowerCase();
    const threadsUrl = `/api/copilotkit/threads?agentId=${agentId}`;
    const previousResponse = await page.request.get(threadsUrl);
    expect(previousResponse.ok()).toBeTruthy();
    const previousIds = new Set<string>(
      (await previousResponse.json()).threads.map(
        (thread: { id: string }) => thread.id,
      ),
    );
    const input = page.locator(".assistant-panel textarea").last();
    await input.fill(
      "Use autopilot_readPage to read this Dashboard from my browser and tell me its heading. If browsing is unavailable, tell me that in chat.",
    );
    await input.press("Enter");

    let threadId = "";
    let messages: StoredMessage[] = [];
    await expect
      .poll(
        async () => {
          const threads = await page.request.get(threadsUrl);
          if (!threads.ok()) return false;
          threadId =
            (await threads.json()).threads.find(
              (thread: { id: string }) => !previousIds.has(thread.id),
            )?.id ?? "";
          if (!threadId) return false;
          const stored = await page.request.get(
            `/api/copilotkit/threads/${threadId}/messages?agentId=${agentId}`,
          );
          if (!stored.ok()) return false;
          messages = (await stored.json()).messages;
          return messages.some(
            (message) =>
              message.role === "assistant" && !!message.content?.trim(),
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    const calls = messages.flatMap(
      (message) => message.toolCalls?.map((call) => call.name) ?? [],
    );
    expect(calls.includes("autopilot_readPage")).toBe(trial.expectAutopilot);
    if (!trial.expectAutopilot) expect(calls).toHaveLength(0);
    await page.screenshot({
      path: resolve(evidenceDir, "scope.png"),
      fullPage: true,
    });
    writeFileSync(
      resolve(evidenceDir, "scope.json"),
      JSON.stringify(
        {
          agentId,
          mode: trial.mode,
          runtimeAutopilot: info.autopilot,
          threadId,
          calls,
          resultRoles: messages.map((message) => message.role),
          assistantText: messages
            .filter((message) => message.role === "assistant")
            .at(-1)?.content,
        },
        null,
        2,
      ),
    );
  });
}
