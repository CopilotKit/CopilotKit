import { expect, test } from "@playwright/test";
import { evidencePath } from "./evidence";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

test("new thread clears the conversation and survives reload", async ({
  page,
}) => {
  // Exercise the sidebar lifecycle without depending on the cloud model service.
  await page.route("**/api/copilotkit/info", (route) =>
    route.fulfill({
      json: {
        version: "1.0.0",
        agents: { logistics: { description: "Logistics", capabilities: {} } },
      },
    }),
  );
  const requests: Array<{
    threadId: string;
    messages: Array<{ content?: string }>;
  }> = [];
  await page.route(/\/api\/copilotkit\/agent\/[^/]+\/run$/, async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const messageId = crypto.randomUUID();
    const events = [
      { type: "RUN_STARTED", threadId: request.threadId, runId: request.runId },
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "A fresh reply." },
      { type: "TEXT_MESSAGE_END", messageId },
      {
        type: "RUN_FINISHED",
        threadId: request.threadId,
        runId: request.runId,
      },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      body: events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  const sidebar = page.getByTestId("copilot-sidebar");
  const storageKey = "northstar:copilotkit:thread:northstar:admin:logistics";
  await expect(sidebar.getByRole("combobox")).toHaveCount(0);
  await sidebar.getByRole("textbox").fill("First conversation");
  await page.getByTestId("copilot-send-button").click();
  await expect(sidebar).toContainText("A fresh reply.");
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey))
    .toBe(requests[0].threadId);
  await sidebar
    .getByRole("button", { name: "New thread", exact: true })
    .click();
  await expect(sidebar).not.toContainText("First conversation");
  await expect(sidebar).not.toContainText("A fresh reply.");
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), storageKey),
  ).toBeNull();
  await sidebar.getByRole("textbox").fill("Second conversation");
  await page.getByTestId("copilot-send-button").click();
  await expect(sidebar).toContainText("A fresh reply.");
  expect(requests).toHaveLength(2);
  expect(requests[1].threadId).not.toBe(requests[0].threadId);
  expect(
    requests[1].messages.some(
      (message) => message.content === "First conversation",
    ),
  ).toBe(false);
  await sidebar
    .getByRole("button", { name: "New thread", exact: true })
    .click();
  await page.reload();
  await expect(sidebar.getByRole("textbox")).toBeVisible();
  await expect(sidebar).not.toContainText("Second conversation");
  await expect(sidebar).not.toContainText("A fresh reply.");
  const screenshot = evidencePath("sidebar", "new-thread.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    sidebar.getByRole("button", { name: "New thread", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: evidencePath("sidebar", "new-thread-mobile.png"),
    fullPage: true,
  });
});

test("an unknown entitlement does not obscure a live sidebar reply", async ({
  page,
}) => {
  await page.route("**/api/copilotkit/info", async (route) => {
    const response = await route.fetch();
    const info = await response.json();
    await route.fulfill({
      response,
      json: {
        ...info,
        licenseStatus: "unknown",
        runtimeEntitlements: {
          status: "unavailable",
          error: {
            code: "runtime_entitlements_unavailable",
            message: "Runtime entitlement lookup failed",
            retryable: false,
          },
        },
      },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  const sidebar = page.getByTestId("copilot-sidebar");
  await expect(sidebar).toBeVisible();

  const threads = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(threads.ok()).toBeTruthy();
  const priorIds = new Set<string>(
    (await threads.json()).threads.map((thread: { id: string }) => thread.id),
  );
  await sidebar.getByRole("textbox").fill("Say hello in one short sentence.");
  await page.getByTestId("copilot-send-button").click();

  let reply = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          "/api/copilotkit/threads?agentId=logistics",
        );
        if (!response.ok()) return false;
        const threadId = (await response.json()).threads.find(
          (thread: { id: string }) => !priorIds.has(thread.id),
        )?.id;
        if (!threadId) return false;
        const messages = await page.request.get(
          `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
        );
        if (!messages.ok()) return false;
        reply =
          (await messages.json()).messages.find(
            (message: { role: string; content: string }) =>
              message.role === "assistant" && message.content,
          )?.content ?? "";
        return reply.length > 0;
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  await expect(sidebar).toContainText(reply.slice(0, 20));
  await expect(
    page.getByText(/feature requires a CopilotKit license/),
  ).toHaveCount(0);
  const screenshot = evidencePath("sidebar", "entitlement-unavailable.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
});
