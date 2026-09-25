import { expect, test } from "@playwright/test";
import { evidencePath } from "./evidence";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

test("CopilotSidebar keeps the assistant controls and chat available", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();

  const sidebar = page.getByTestId("copilot-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    sidebar.getByRole("combobox", { name: "Assistant agent" }),
  ).toHaveValue("logistics");
  await expect(
    sidebar.getByRole("combobox", { name: "Autopilot scope" }),
  ).toHaveValue("logistics");
  await expect(sidebar.getByRole("textbox")).toBeVisible();

  const screenshot = evidencePath("sidebar", "copilot-sidebar.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });

  await sidebar.getByRole("button", { name: "Close" }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(
    page.getByRole("heading", { name: "Create order" }),
  ).toBeVisible();
  await page.getByTestId("copilot-chat-toggle").click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await sidebar
    .getByRole("combobox", { name: "Assistant agent" })
    .selectOption("operations");
  await expect(
    sidebar.getByRole("combobox", { name: "Assistant agent" }),
  ).toHaveValue("operations");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeVisible();
  const agentLabel = sidebar
    .getByRole("combobox", { name: "Assistant agent" })
    .locator("..");
  expect((await agentLabel.boundingBox())?.x).toBeGreaterThanOrEqual(0);
  await expect(page.locator("body")).toHaveCSS("margin-inline-end", "0px");
  const hideInspector = page.getByRole("button", {
    name: "Hide Inspector for a day",
  });
  if (await hideInspector.isVisible()) await hideInspector.click();
  const mobileScreenshot = evidencePath(
    "sidebar",
    "copilot-sidebar-mobile.png",
  );
  await page.screenshot({ path: mobileScreenshot, fullPage: true });
  await sidebar.getByRole("button", { name: "Close" }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
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
