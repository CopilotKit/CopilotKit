import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live agent cancels only after CopilotKit chat approval", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-010", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-AUTO-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Cobalt Field Supplies', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const status = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  expect(status()).toEqual({ status: "booked", version: 1 });

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(baseline.ok()).toBeTruthy();
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let approvalBeforeStatus: { status: string; version: number } | undefined;
  let confirmation = "";
  const approval = (async () => {
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    await expect(page.locator("button[data-copilot-highlight]")).toHaveCount(1);
    confirmation = (await card.textContent()) ?? "";
    approvalBeforeStatus = status();
    await page.screenshot({ path: resolve(evidenceDir, "approval-chat.png") });
    await card.getByRole("button", { name: "Approve" }).click();
  })();
  const prompts = [
    `Please cancel order ${reference} for Cobalt Field Supplies. Find it using the current page, navigate to its detail page, and use the existing cancel action. I will review the confirmation.`,
    `Find shipment ${reference} and cancel it in the app. Open its details and let me decide in the confirmation dialog.`,
    `I need ${reference} cancelled. Inspect the screen, locate that order, and use its visible cancellation control. I'll handle the confirmation.`,
  ];
  const variant = Number(process.env.AUTOPILOT_CANCEL_PROMPT_VARIANT ?? 0);
  const prompt = prompts[variant] ?? prompts[0];
  await page.locator(".assistant-panel textarea").last().fill(prompt);
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
        const calls = messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name);
        return (
          calls.includes("autopilot_activateControl") &&
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content?.includes('"status":"completed"'),
          ) &&
          status().status === "cancelled"
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(confirmation).toContain(reference);
  expect(approvalBeforeStatus).toEqual({ status: "booked", version: 1 });
  expect(status()).toEqual({ status: "cancelled", version: 2 });
  await expect(page.locator("[data-copilot-highlight]")).toHaveCount(0);
  await expect(page.getByTestId("copilot-status-notice")).toHaveCount(0);
  await page.screenshot({
    path: resolve(evidenceDir, "cancelled-order.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "cancel.json"),
    JSON.stringify(
      {
        threadId,
        prompt,
        reference,
        confirmation,
        approvalBeforeStatus,
        finalStatus: status(),
        toolSequence: messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name),
      },
      null,
      2,
    ),
  );
});

test("declining CopilotKit chat approval leaves the order unchanged", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-010", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-DECLINE-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Harbor Demo Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const status = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(baseline.ok()).toBeTruthy();
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let approvalBeforeStatus: { status: string; version: number } | undefined;
  let confirmation = "";
  const approval = (async () => {
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    confirmation = (await card.textContent()) ?? "";
    approvalBeforeStatus = status();
    await card.getByRole("button", { name: "Decline" }).focus();
    await page.keyboard.press("Enter");
  })();
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `Please cancel order ${reference} for Harbor Demo Client using its detail page. I will decide at the confirmation.`,
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
            message.content?.includes('"status":"denied"'),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(confirmation).toContain(reference);
  expect(approvalBeforeStatus).toEqual({ status: "booked", version: 1 });
  expect(status()).toEqual({ status: "booked", version: 1 });
  writeFileSync(
    resolve(evidenceDir, "decline.json"),
    JSON.stringify(
      {
        threadId,
        reference,
        confirmation,
        approvalBeforeStatus,
        finalStatus: status(),
        toolSequence: messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name),
      },
      null,
      2,
    ),
  );
});

test("a dispatched order cannot be cancelled by the agent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-010", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-DISPATCH-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Dispatched Demo Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'in_transit', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const status = () =>
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
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `Please cancel order ${reference} for Dispatched Demo Client. Check its detail page and tell me the actual outcome.`,
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
        const navigated = messages.some(
          (message) =>
            message.role === "tool" &&
            message.content?.includes(`/orders/${id}`),
        );
        const final = messages.some(
          (message) =>
            message.role === "assistant" &&
            (message.content ?? "").includes(reference) &&
            /not|unable|cannot|can.t|rejected|failed/i.test(
              message.content ?? "",
            ),
        );
        return navigated && final;
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(dialogs).toBe(0);
  expect(status()).toEqual({ status: "in_transit", version: 1 });
  writeFileSync(
    resolve(evidenceDir, "dispatched.json"),
    JSON.stringify(
      {
        threadId,
        reference,
        finalStatus: status(),
        dialogs,
        toolSequence: messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name),
      },
      null,
      2,
    ),
  );
});
