import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live stale cancel approval cannot change a newer order version", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-023", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-STALE-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Stale Approval Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const previousResponse = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  const previousIds = new Set<string>(
    (await previousResponse.json()).threads.map(
      (thread: { id: string }) => thread.id,
    ),
  );
  let approvalBefore: { status: string; version: number } | undefined;
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(reference);
    approvalBefore = state();
    database
      .prepare("UPDATE orders SET version = 2, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    await dialog.accept();
  });
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `Find ${reference} for Stale Approval Client, open its detail page, and cancel it through the declared browser action. I will review the confirmation. Report the actual result.`,
    );
  await page.locator(".assistant-panel button").last().click();

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
        threadId =
          (await threads.json()).threads.find(
            (thread: { id: string }) => !previousIds.has(thread.id),
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
            message.content?.includes('"status":"failed"'),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(approvalBefore).toEqual({ status: "booked", version: 1 });
  expect(state()).toEqual({ status: "booked", version: 2 });
  expect(
    messages
      .flatMap((message) => message.toolCalls ?? [])
      .map((call) => call.name),
  ).toContain("autopilot_activateControl");
  writeFileSync(
    resolve(evidenceDir, "stale-approval.json"),
    JSON.stringify(
      {
        threadId,
        reference,
        approvalBefore,
        finalState: state(),
        toolResult: messages.find(
          (message) =>
            message.role === "tool" &&
            message.content?.includes('"status":"failed"'),
        )?.content,
      },
      null,
      2,
    ),
  );
  database.close();
});
