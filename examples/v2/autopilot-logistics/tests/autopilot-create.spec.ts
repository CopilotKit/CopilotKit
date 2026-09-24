import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live agent creates an order through discovered form controls after review", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = resolve(
    process.cwd(),
    "../../../.context/autopilot-evidence/iteration-012",
    String(Date.now()),
  );
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
    { readOnly: true },
  );
  const customer = `Cobalt Launch ${Date.now()}`;
  const order = () =>
    database
      .prepare(
        "SELECT id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, version FROM orders WHERE customer = ?",
      )
      .get(customer) as Record<string, unknown> | undefined;
  expect(order()).toBeUndefined();
  await page.addInitScript(() => {
    const originalConfirm = window.confirm.bind(window);
    (window as any).__autopilotSequence = [] as Array<{
      kind: string;
      name?: string;
      accepted?: boolean;
    }>;
    window.confirm = (message) => {
      const accepted = originalConfirm(message);
      (window as any).__autopilotSequence.push({ kind: "decision", accepted });
      return accepted;
    };
    document.addEventListener(
      "input",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("form[data-autopilot-draft-id]")
        ) {
          (window as any).__autopilotSequence.push({
            kind: "input",
            name: target.getAttribute("name") ?? "",
          });
        }
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
  expect(baseline.ok()).toBeTruthy();
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let review = "";
  let beforeApproval: Record<string, unknown> | undefined;
  page.once("dialog", async (dialog) => {
    review = dialog.message();
    beforeApproval = order();
    await dialog.accept();
  });
  const prompt = `Create a booked express order for ${customer} from 10 Fiction Way, Portland, OR to 20 Example Street, Seattle, WA, requested ship date 2026-11-18, assigned to Jordan Lee, with notes "Dock 2". Use the app's create form and submit after I review the exact values in its confirmation.`;
  await page.locator(".assistant-panel textarea").last().fill(prompt);
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
        return (
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content?.includes('"status":"completed"'),
          ) && !!order()
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(beforeApproval).toBeUndefined();
  expect(review).toContain(customer);
  expect(review).toContain("2026-11-18");
  expect(review).toContain("20 Example Street, Seattle, WA");
  expect(order()).toMatchObject({
    customer,
    origin: "10 Fiction Way, Portland, OR",
    destination: "20 Example Street, Seattle, WA",
    ship_date: "2026-11-18",
    service_level: "express",
    assigned_user_id: "operator",
    status: "booked",
    notes: "Dock 2",
    version: 1,
  });
  expect(
    (
      database
        .prepare("SELECT count(*) AS count FROM orders WHERE customer = ?")
        .get(customer) as { count: number }
    ).count,
  ).toBe(1);
  await expect(
    page.getByRole("heading", { name: String(order()?.reference) }),
  ).toBeVisible();
  const sequence = await page.evaluate(
    () =>
      (window as any).__autopilotSequence as Array<{
        kind: string;
        name?: string;
        accepted?: boolean;
      }>,
  );
  expect(sequence[0]).toEqual({ kind: "decision", accepted: true });
  expect(sequence.some((event) => event.kind === "input")).toBe(true);
  const calls = messages
    .flatMap((message) => message.toolCalls ?? [])
    .map((call) => call.name);
  expect(calls).toContain("autopilot_submitForm");
  await page.screenshot({
    path: resolve(evidenceDir, "created-order.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "create.json"),
    JSON.stringify(
      {
        threadId,
        customer,
        review,
        beforeApproval: null,
        finalOrder: order(),
        sequence,
        toolSequence: calls,
      },
      null,
      2,
    ),
  );
});

test("declining discovered form review leaves inputs and SQL untouched", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = resolve(
    process.cwd(),
    "../../../.context/autopilot-evidence/iteration-012",
    String(Date.now()),
  );
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
    { readOnly: true },
  );
  const customer = `Declined Launch ${Date.now()}`;
  const count = () =>
    (
      database
        .prepare("SELECT count(*) AS count FROM orders WHERE customer = ?")
        .get(customer) as { count: number }
    ).count;
  await page.addInitScript(() => {
    const originalConfirm = window.confirm.bind(window);
    (window as any).__autopilotSequence = [] as Array<{
      kind: string;
      name?: string;
      accepted?: boolean;
    }>;
    window.confirm = (message) => {
      const accepted = originalConfirm(message);
      (window as any).__autopilotSequence.push({ kind: "decision", accepted });
      return accepted;
    };
    document.addEventListener(
      "input",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("form[data-autopilot-draft-id]")
        ) {
          (window as any).__autopilotSequence.push({
            kind: "input",
            name: target.getAttribute("name") ?? "",
          });
        }
      },
      true,
    );
  });
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
  let beforeApproval = -1;
  page.once("dialog", async (dialog) => {
    review = dialog.message();
    beforeApproval = count();
    await dialog.dismiss();
  });
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `Create a booked express order for ${customer} from 10 Fiction Way, Portland, OR to 20 Example Street, Seattle, WA, shipping 2026-11-18. Use the create form; I will review the exact values.`,
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
        return messages.some(
          (message) =>
            message.role === "tool" &&
            message.content?.includes('"status":"denied"'),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(review).toContain(customer);
  expect(beforeApproval).toBe(0);
  expect(count()).toBe(0);
  const sequence = await page.evaluate(
    () =>
      (window as any).__autopilotSequence as Array<{
        kind: string;
        name?: string;
        accepted?: boolean;
      }>,
  );
  expect(sequence).toEqual([{ kind: "decision", accepted: false }]);
  await expect(
    page
      .getByRole("form", { name: "Create order" })
      .getByRole("textbox", { name: "Customer" }),
  ).toHaveValue("");
  writeFileSync(
    resolve(evidenceDir, "decline.json"),
    JSON.stringify(
      {
        threadId,
        customer,
        review,
        beforeApproval,
        finalCount: count(),
        sequence,
        toolSequence: messages
          .flatMap((message) => message.toolCalls ?? [])
          .map((call) => call.name),
      },
      null,
      2,
    ),
  );
});
