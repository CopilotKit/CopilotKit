import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import type { Response } from "@playwright/test";
import { z } from "zod";

/**
 * Headless Chat (Complete) — full headless surface in one demo. The
 * hand-rolled chat shell wires every render hook CopilotKit exposes
 * (useRenderTool, useDefaultRenderTool, useComponent, useRenderToolCall,
 * useSuggestions, useAttachments) on top of shadcn primitives.
 *
 * The 5-test plan drives the 4 empty-state pills and asserts:
 *   - the per-tool render component (Weather / Stock / Highlight / Chart)
 *     is mounted on the headless surface (scoped testid)
 *   - the assistant narration arrives in the custom message-assistant
 *     bubble (`[data-testid="headless-message-assistant"]`)
 *
 * Each pill exercises a distinct tool renderer; weather, stock, and revenue
 * share useRenderTool. If the surface silently demotes back to the default
 * <CopilotChat />, the headless-specific testids vanish and all 4 tool
 * tests fail.
 */

const PILL_WEATHER = "Try suggestion: What's the weather in Tokyo?";
const PILL_STOCK = "Try suggestion: What's AAPL trading at?";
const PILL_HIGHLIGHT = "Try suggestion: Highlight: ship the demo on Friday";
const PILL_CHART =
  "Try suggestion: Show me a chart of revenue over the last six months";

const ASSERT_TIMEOUT = 45_000;

// Cover setup/native acquisition (60s), three sequential 45s assertions,
// and short content checks (45s). This also covers the discovery regression.
test.setTimeout(240_000);

async function readNativeStock(response: Response) {
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/event-stream");
  const request = z
    .object({
      method: z.literal("agent/run"),
      params: z.object({ agentId: z.literal("headless-complete") }),
      body: z.object({ runId: z.string(), threadId: z.string() }),
    })
    .parse(response.request().postDataJSON());
  // Read the completed body, so arbitrary network chunk boundaries cannot
  // split an event. Join multiline SSE data fields before decoding JSON.
  const raw = await response.text();
  const events = raw
    .split(/\r?\n\r?\n/)
    .map((frame) =>
      frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter(Boolean)
    .map((data) =>
      z.object({ type: z.string() }).passthrough().parse(JSON.parse(data)),
    );
  for (const type of ["RUN_STARTED", "RUN_FINISHED"]) {
    expect(events.filter((event) => event.type === type)).toEqual([
      expect.objectContaining({ type, ...request.body }),
    ]);
  }
  expect(events[0]?.type).toBe("RUN_STARTED");
  expect(events.at(-1)?.type).toBe("RUN_FINISHED");
  expect(events.filter((event) => event.type === "RUN_ERROR")).toHaveLength(0);
  const starts = events.filter(
    (event) =>
      event.type === "TOOL_CALL_START" &&
      event.toolCallName === "get_stock_price",
  );
  expect(starts).toHaveLength(1);
  const callId = z.string().min(1).parse(starts[0].toolCallId);
  const callEvents = events.filter((event) => event.toolCallId === callId);
  expect(callEvents[0]).toBe(starts[0]);
  expect(
    callEvents.filter((event) => event.type === "TOOL_CALL_START"),
  ).toHaveLength(1);
  expect(
    callEvents.filter((event) => event.type === "TOOL_CALL_END"),
  ).toHaveLength(1);
  const results = callEvents.filter(
    (event) => event.type === "TOOL_CALL_RESULT",
  );
  expect(results).toHaveLength(1);
  expect(callEvents.at(-2)?.type).toBe("TOOL_CALL_END");
  expect(callEvents.at(-1)).toBe(results[0]);
  const args = callEvents.slice(1, -2);
  expect(args.length).toBeGreaterThan(0);
  expect(args.every((event) => event.type === "TOOL_CALL_ARGS")).toBe(true);
  expect(
    JSON.parse(args.map((event) => z.string().parse(event.delta)).join("")),
  ).toEqual({ ticker: "AAPL" });
  const stock = z
    .object({
      ticker: z.literal("AAPL"),
      price_usd: z.number().finite(),
      change_pct: z.number().finite(),
    })
    .parse(JSON.parse(z.string().parse(results[0].content)));
  return { stock, raw, request };
}

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with custom composer and four suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="headless-composer"]'),
    ).toBeVisible();

    // Pills use aria-label `Try suggestion: ${prompt}` so screen readers can
    // disambiguate. We assert all four are mounted on first paint.
    await expect(
      page.getByRole("button", { name: PILL_WEATHER, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_STOCK, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_HIGHLIGHT, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_CHART, exact: true }),
    ).toBeVisible();
  });

  test("weather pill renders the headless WeatherCard via useRenderTool plus the deterministic narration", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_WEATHER, exact: true }).click();

    const card = page.locator('[data-testid="headless-weather-card"]').first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("Tokyo");
    await expect(card).toContainText("Sunny");
    const temperature = card.locator(
      '[data-slot="card-content"] > div > div:last-child > div',
    );
    await expect(temperature).toBeVisible();
    await expect(temperature).toHaveText("85°F");

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .last();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(
      "I retrieved the weather for Tokyo. The result includes the temperature and conditions.",
      { timeout: ASSERT_TIMEOUT },
    );
  });

  test("AAPL pill renders the native stock result plus truthful narration", async ({
    page,
  }, testInfo) => {
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/copilotkit-mcp-apps" &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.method === "agent/run",
    );
    await page.getByRole("button", { name: PILL_STOCK, exact: true }).click();
    const { stock, raw, request } = await readNativeStock(
      await responsePromise,
    );
    await testInfo.attach("native-stock.sse", {
      body: raw,
      contentType: "text/event-stream",
    });
    await testInfo.attach("native-stock.json", {
      body: JSON.stringify({ request, stock }),
      contentType: "application/json",
    });

    const card = page.locator('[data-testid="headless-stock-card"]').first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("AAPL");
    await expect(card).toContainText("Last price");
    await expect(card).not.toContainText("Pricing...");
    await expect(
      card.getByText(`$${stock.price_usd.toFixed(2)}`, { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText(
        `${stock.change_pct >= 0 ? "+" : ""}${stock.change_pct}%`,
        { exact: true },
      ),
    ).toBeVisible();

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .last();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(
      "I retrieved AAPL's price and percentage change. The stock result above shows the returned values.",
      { timeout: ASSERT_TIMEOUT },
    );
  });

  test("highlight pill renders the headless HighlightNote via useComponent plus the deterministic narration", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: PILL_HIGHLIGHT, exact: true })
      .click();

    // The highlight card is the frontend-tool render surface (useComponent).
    const card = page
      .locator('[data-testid="headless-highlight-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("ship the demo on Friday");

    // Highlight narration is in d6/agno/headless-complete.json and
    // d6/agno/gen-ui-headless-complete.json; the generic showcase-assistant
    // catch-all lives in d4/agno/chat.json.
    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .last();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText("ship the demo on Friday", {
      timeout: ASSERT_TIMEOUT,
    });
  });

  test("revenue chart pill renders the headless ChartCard via useRenderTool plus the deterministic narration", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_CHART, exact: true }).click();

    const card = page.locator('[data-testid="headless-revenue-chart"]').first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("Quarterly revenue");
    await expect(card).toContainText("Last six months · USD thousands");

    // Month labels come from the python tool's deterministic mock series
    // (Jan…Jun); recharts renders them as <text> tick labels inside the SVG.
    for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]) {
      await expect(card).toContainText(month);
    }

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .last();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(
      "Revenue rose overall from January to June, with a dip in April and its highest value in June.",
      { timeout: ASSERT_TIMEOUT },
    );
  });
});

test("submission waits for discovery without losing the draft or first turn", async ({
  page,
}) => {
  const { promise: infoGate, resolve: releaseInfo } =
    Promise.withResolvers<void>();
  const { promise: infoRequested, resolve: observedInfo } =
    Promise.withResolvers<void>();
  let runs = 0;
  await page.route("**/api/copilotkit-mcp-apps", async (route) => {
    const method = route.request().postDataJSON()?.method;
    if (method === "info") {
      observedInfo();
      await infoGate;
    }
    if (method === "agent/run") runs++;
    await route.continue();
  });
  try {
    await page.goto("/demos/headless-complete");
    await infoRequested;
    for (const name of [PILL_WEATHER, PILL_STOCK, PILL_HIGHLIGHT, PILL_CHART]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeDisabled();
    }
    const composer = page.getByRole("textbox", {
      name: "Message the agent or drop a file...",
    });
    await composer.fill("Keep this draft while connecting");
    await page.locator('input[type="file"]').setInputFiles({
      name: "draft.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      page.getByRole("img", { name: "draft.png", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await composer.press("Enter");
    await expect(composer).toHaveValue("Keep this draft while connecting");
    await expect(
      page.getByRole("img", { name: "draft.png", exact: true }),
    ).toBeVisible();
    expect(runs).toBe(0);
    releaseInfo();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("img", { name: "draft.png", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Remove attachment", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: PILL_WEATHER, exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: PILL_WEATHER, exact: true }).click();
    const temperature = page
      .getByTestId("headless-weather-card")
      .locator('[data-slot="card-content"] > div > div:last-child > div');
    await expect(temperature).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(temperature).toHaveText("85°F", { timeout: ASSERT_TIMEOUT });
    await expect(
      page.getByTestId("headless-message-assistant").last(),
    ).toContainText("I retrieved the weather for Tokyo.", {
      timeout: ASSERT_TIMEOUT,
    });
    await expect(composer).toHaveValue("Keep this draft while connecting");
    expect(runs).toBe(1);
  } finally {
    releaseInfo();
  }
});
