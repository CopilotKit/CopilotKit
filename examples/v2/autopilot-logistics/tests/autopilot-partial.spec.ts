import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("an intervening form change reports a partial fill without submitting", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-044", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-PARTIAL-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Partial Client', 'Portland', 'Seattle', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database
      .prepare("SELECT origin, destination, version FROM orders WHERE id = ?")
      .get(id);
  const original = state();

  await page.addInitScript(() => {
    let intervened = false;
    document.addEventListener(
      "input",
      (event) => {
        const field = event.target;
        if (
          intervened ||
          event.isTrusted ||
          !(field instanceof HTMLInputElement) ||
          !["origin", "destination"].includes(field.name) ||
          !field.closest("form[data-autopilot-record-id]")
        )
          return;
        const otherName = field.name === "origin" ? "destination" : "origin";
        field.form?.querySelector(`[name="${otherName}"]`)?.remove();
        intervened = true;
      },
      true,
    );
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let review = "";
  const approval = (async () => {
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    review = (await card.textContent()) ?? "";
    expect(state()).toEqual(original);
    await card.getByRole("button", { name: "Approve" }).click();
  })();
  const prompt = `For order ${reference}, change origin to Tacoma and destination to Spokane in its edit form, then submit after I review both values.`;
  await page.locator(".assistant-panel textarea").last().fill(prompt);
  await page.locator(".assistant-panel button").last().click();
  await approval;

  let threadId = "";
  let messages: Array<{ role: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        const threads = await page.request.get(
          "/api/copilotkit/threads?agentId=logistics",
        );
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
            message.content?.includes('"status":"partial"'),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(review).toContain("Tacoma");
  expect(review).toContain("Spokane");
  expect(state()).toEqual(original);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
        );
        messages = (await response.json()).messages;
        return (
          messages.at(-1)?.role === "assistant" &&
          (messages.at(-1)?.content?.length ?? 0) > 15
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.getByTestId("copilot-approval")).toHaveCount(0);
  await expect(page.getByTestId("copilot-status-notice")).toContainText(
    "The form was not submitted",
  );
  await page.screenshot({
    path: resolve(evidenceDir, "partial-notice.png"),
    fullPage: true,
  });
  const finalAnswer = messages.at(-1)?.content ?? "";
  expect(finalAnswer).not.toMatch(
    /(?:has been saved|were saved|is saved|successfully submitted|has been submitted|was persisted)/i,
  );
  writeFileSync(
    resolve(evidenceDir, "partial.json"),
    JSON.stringify(
      {
        threadId,
        prompt,
        review,
        before: original,
        after: state(),
        finalAnswer,
        partialResult: messages.find(
          (message) =>
            message.role === "tool" &&
            message.content?.includes('"status":"partial"'),
        )?.content,
      },
      null,
      2,
    ),
  );
  database.close();
});

test("unsupported visible field is refused before review or input", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const evidenceDir = evidencePath("iteration-045", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-UNSUPPORTED-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Unsupported Client', 'Portland', 'Seattle', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database.prepare("SELECT status, version FROM orders WHERE id = ?").get(id);
  const original = state();

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto(`/orders/${id}`);
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
  await page.evaluate(() => {
    const form = document.querySelector("form[data-autopilot-record-id]");
    const label = document.createElement("label");
    label.textContent = "Fragile handling";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "fragileHandling";
    label.appendChild(checkbox);
    form?.appendChild(label);
  });
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  const prompt = `On order ${reference}, check the visible Fragile handling checkbox and save the edit. I will review if the app asks.`;
  await page.locator(".assistant-panel textarea").last().fill(prompt);
  await page.locator(".assistant-panel button").last().click();

  let threadId = "";
  let messages: Array<{ role: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        const threads = await page.request.get(
          "/api/copilotkit/threads?agentId=logistics",
        );
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
        return (
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content?.includes("not supported for automatic fill"),
          ) ||
          (messages.at(-1)?.role === "assistant" &&
            (messages.at(-1)?.content?.length ?? 0) > 15)
        );
      },
      { timeout: 75_000 },
    )
    .toBe(true);
  const checked = await page
    .getByRole("checkbox", { name: "Fragile handling" })
    .isChecked();
  const approvalShown =
    (await page.getByTestId("copilot-approval").count()) > 0;
  expect(checked).toBe(false);
  expect(approvalShown).toBe(false);
  expect(state()).toEqual(original);
  writeFileSync(
    resolve(evidenceDir, "unsupported.json"),
    JSON.stringify(
      {
        threadId,
        prompt,
        refusal: messages.find(
          (message) =>
            message.role === "tool" &&
            message.content?.includes("not supported for automatic fill"),
        )?.content,
        checked,
        approvalShown,
        before: original,
        after: state(),
      },
      null,
      2,
    ),
  );
  database.close();
});
