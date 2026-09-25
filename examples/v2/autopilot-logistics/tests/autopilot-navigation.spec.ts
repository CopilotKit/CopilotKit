import { evidencePath } from "./evidence";
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
  const evidenceDir = evidencePath("iteration-009", String(Date.now()));
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

test("live agent finds one order, visits its detail and Users, then returns", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-FIND-${Date.now()}`;
  const now = new Date().toISOString();
  await page.goto("/sign-in");
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Find Demo Client', '1 Sample Way', '2 Example Road', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `Visit Orders, read the page, find order ${reference}, navigate via its discovered link to its detail, read the detail, then visit Users and use goBack to return to the order detail. Tell me the order's customer and current status. Use the browser tools for each step.`,
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
        const results = messages
          .filter((message) => message.role === "tool")
          .map((message) => message.content ?? "");
        return (
          results.some(
            (result) =>
              result.includes(reference) && result.includes('"path":"/orders"'),
          ) &&
          results.some(
            (result) =>
              result.includes('"path":"/orders/' + id + '"') &&
              result.includes('"status":"arrived"'),
          ) &&
          results.some(
            (result) =>
              result.includes('"path":"/users"') &&
              result.includes('"status":"arrived"'),
          ) &&
          results.filter(
            (result) =>
              result.includes('"path":"/orders/' + id + '"') &&
              result.includes('"status":"arrived"'),
          ).length >= 2
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  await expect(page).toHaveURL(new RegExp(`/orders/${id}$`));
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
  const calls = messages
    .flatMap((message) => message.toolCalls ?? [])
    .map((call) => call.name);
  expect(calls).toContain("autopilot_readPage");
  expect(calls).toContain("autopilot_navigate");
  expect(calls).toContain("autopilot_goBack");
  const evidenceDir = evidencePath("iteration-017", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: resolve(evidenceDir, "order-navigation.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "order-navigation.json"),
    JSON.stringify(
      {
        threadId,
        reference,
        orderId: id,
        toolSequence: calls,
        results: messages
          .filter((message) => message.role === "tool")
          .map((message) => (message.content ?? "").slice(0, 400)),
      },
      null,
      2,
    ),
  );
});

test("live agent respects the app's unsaved-change navigation refusal", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto("/orders/new");
  const form = page.getByRole("form", { name: "Create order" });
  await form
    .getByRole("textbox", { name: "Customer" })
    .fill("Unsaved Browser Draft");
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let review = "";
  page.once("dialog", async (dialog) => {
    review = dialog.message();
    await dialog.dismiss();
  });
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      "Use autopilot_navigate to visit the Users section now. If the app refuses because of unsaved changes, report that refusal and do not force navigation.",
    );
  await page.locator(".assistant-panel button").last().click();
  let threadId = "";
  let messages: Array<{ role: string; content?: string }> = [];
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
            message.content?.includes('"status":"refused"'),
        );
      },
      { timeout: 65_000 },
    )
    .toBe(true);
  expect(review).toContain("Discard unsaved order changes?");
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(form.getByRole("textbox", { name: "Customer" })).toHaveValue(
    "Unsaved Browser Draft",
  );
  const evidenceDir = evidencePath("iteration-018", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: resolve(evidenceDir, "refused-navigation.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "refused-navigation.json"),
    JSON.stringify(
      {
        threadId,
        review,
        path: new URL(page.url()).pathname,
        toolResults: messages
          .filter((message) => message.role === "tool")
          .map((message) => (message.content ?? "").slice(0, 400)),
      },
      null,
      2,
    ),
  );
});
