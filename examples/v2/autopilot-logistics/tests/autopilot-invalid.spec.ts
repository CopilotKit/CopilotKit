import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("invalid status transition through discovered form leaves SQL unchanged", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-013", `invalid-${Date.now()}`);
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-INVALID-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Transition Demo Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(baseline.ok()).toBeTruthy();
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let review = "";
  let beforeApproval: { status: string; version: number } | undefined;
  const approval = (async () => {
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    review = (await card.textContent()) ?? "";
    beforeApproval = state();
    await card.getByRole("button", { name: "Approve" }).click();
  })();
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `For order ${reference} (Transition Demo Client), try changing its status directly from Booked to Delivered using the app's edit form. I will review the exact change. Report the actual validation outcome.`,
    );
  await page.locator(".assistant-panel button").last().click();
  await approval;
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
            message.content?.includes('"status":"failed"'),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(review).toContain("booked → delivered");
  expect(beforeApproval).toEqual({ status: "booked", version: 1 });
  expect(state()).toEqual({ status: "booked", version: 1 });
  await expect(
    page
      .getByRole("form", { name: `Edit order ${reference}` })
      .getByRole("alert"),
  ).toContainText(/cannot move booked to delivered/i);
  writeFileSync(
    resolve(evidenceDir, "invalid-transition.json"),
    JSON.stringify(
      {
        threadId,
        reference,
        review,
        beforeApproval,
        finalState: state(),
        toolSequence: messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name),
      },
      null,
      2,
    ),
  );
});
