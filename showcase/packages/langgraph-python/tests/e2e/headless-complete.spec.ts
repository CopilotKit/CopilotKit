import { test, expect, type Page } from "@playwright/test";

async function mockWeatherAgent(page: Page) {
  await page.route("**/api/copilotkit", async (route) => {
    const body = route.request().postData() || "";
    const isWeatherRun = body.includes("Lisbon");
    const events = isWeatherRun ? weatherEvents() : idleEvents();

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
}

test.describe("Fully Headless UI", () => {
  test("page loads the custom headless chat shell", async ({ page }) => {
    await mockWeatherAgent(page);
    await page.goto("/demos/headless-complete");

    await expect(page.getByTestId("headless-chat")).toBeVisible();
    await expect(
      page.getByPlaceholder("Ask the headless chat about the weather"),
    ).toBeVisible();
    await expect(
      page.getByText("Try a weather question and the assistant will answer"),
    ).toBeVisible();
  });

  test("weather prompt renders tool UI through the resolver path", async ({
    page,
  }) => {
    await mockWeatherAgent(page);
    await page.goto("/demos/headless-complete");

    const input = page.getByPlaceholder(
      "Ask the headless chat about the weather",
    );
    await input.fill("What's the weather like in Lisbon?");
    await input.press("Enter");

    await expect(page.getByTestId("headless-tool-renderings")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("weather-card")).toBeVisible({
      timeout: 30000,
    });
  });
});

function idleEvents() {
  return [
    {
      type: "RUN_STARTED",
      threadId: "headless-e2e-thread",
      runId: "headless-e2e-idle-run",
    },
    {
      type: "RUN_FINISHED",
      threadId: "headless-e2e-thread",
      runId: "headless-e2e-idle-run",
    },
  ];
}

function weatherEvents() {
  const threadId = "headless-e2e-thread";
  const runId = "headless-e2e-weather-run";
  const messageId = "headless-e2e-assistant-message";
  const toolCallId = "headless-e2e-weather-call";

  return [
    {
      type: "RUN_STARTED",
      threadId,
      runId,
    },
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "get_weather",
      parentMessageId: messageId,
    },
    {
      type: "TOOL_CALL_ARGS",
      toolCallId,
      delta: JSON.stringify({ location: "Lisbon" }),
    },
    {
      type: "TOOL_CALL_END",
      toolCallId,
    },
    {
      type: "TOOL_CALL_RESULT",
      messageId: "headless-e2e-weather-result",
      toolCallId,
      role: "tool",
      content: JSON.stringify({
        city: "Lisbon",
        temperature: 21,
        conditions: "clear",
        humidity: 58,
        wind_speed: 9,
        feels_like: 22,
      }),
    },
    {
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant",
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: "Lisbon is clear and mild right now.",
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId,
    },
    {
      type: "RUN_FINISHED",
      threadId,
      runId,
    },
  ];
}
