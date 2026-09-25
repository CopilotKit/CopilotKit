import { expect, test } from "@playwright/test";
import { evidencePath } from "./evidence";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

test("CopilotPopup keeps the assistant controls and chat available", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();

  const popup = page.getByTestId("copilot-popup");
  await expect(popup).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    popup.getByRole("combobox", { name: "Assistant agent" }),
  ).toHaveValue("logistics");
  await expect(
    popup.getByRole("combobox", { name: "Autopilot scope" }),
  ).toHaveValue("logistics");
  await expect(popup.getByRole("textbox")).toBeVisible();

  const screenshot = evidencePath("popup", "copilot-popup.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });

  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toBeHidden();
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(
    page.getByRole("heading", { name: "Create order" }),
  ).toBeVisible();
  await page.getByTestId("copilot-chat-toggle").click();
  await expect(popup).toBeVisible();
  await popup
    .getByRole("combobox", { name: "Assistant agent" })
    .selectOption("operations");
  await expect(
    popup.getByRole("combobox", { name: "Assistant agent" }),
  ).toHaveValue("operations");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toBeHidden();
});

test("an unknown entitlement does not obscure a live popup reply", async ({
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
  const popup = page.getByTestId("copilot-popup");
  await expect(popup).toBeVisible();

  const threads = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(threads.ok()).toBeTruthy();
  const priorIds = new Set<string>(
    (await threads.json()).threads.map((thread: { id: string }) => thread.id),
  );
  await popup.getByRole("textbox").fill("Say hello in one short sentence.");
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

  await expect(popup).toContainText(reply.slice(0, 20));
  await expect(
    page.getByText(/feature requires a CopilotKit license/),
  ).toHaveCount(0);
  const screenshot = evidencePath("popup", "entitlement-unavailable.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
});
