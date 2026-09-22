import { createPlaywrightProbeExecutor } from "../../../../harness/src/probes/frontend-matrix-playwright.js";
import { buildTurns as buildCanonicalTurns } from "../../../../harness/src/probes/scripts/d5-gen-ui-custom.js";
import { test, expect } from "@playwright/test";

// Tool-Based Generative UI demo: a centered <CopilotChat> with two
// useComponent registrations (render_bar_chart + render_pie_chart) plus
// three suggestion pills wired via useConfigureSuggestions. The demo
// has no header / chrome — the chat surface IS the page.
test.describe("@diagnostic Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("@diagnostic page loads with chat composer and the three suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });

    for (const title of [
      "Sales bar chart",
      "Traffic pie chart",
      "Market share",
    ]) {
      await expect(
        page
          .locator('[data-testid="copilot-suggestion"]')
          .filter({ hasText: title }),
      ).toBeVisible({ timeout: 15000 });
    }
  });

  test("@diagnostic pie chart request renders SVG visualization", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me a pie chart of revenue by category");
    await input.press("Enter");

    // PieChart renders as Recharts SVG inside the assistant message.
    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistantMessage.locator("svg").first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("@diagnostic bar chart request renders SVG visualization", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me a bar chart of monthly expenses");
    await input.press("Enter");

    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistantMessage.locator("svg").first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("@diagnostic sends message and gets assistant response", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});

/** Functional proof is this runner artifact; supplemental test totals are not acceptance. */
test("@canonical rendering gen-ui-tool-based: all actual LGP pills and results", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(480_000);
  if (!baseURL)
    throw new Error(
      "canonical rendering requires configured actual demo baseURL",
    );
  const featureType = "gen-ui-custom" as const;
  const run = createPlaywrightProbeExecutor({
    browser,
    scripts: new Map([
      [
        featureType,
        { featureTypes: [featureType], buildTurns: buildCanonicalTurns },
      ],
    ]),
    probeTimeoutMs: 450_000,
  });
  const result = await run({
    cell: {
      id: "react/pydantic-ai/gen-ui-tool-based",
      frontend: "react",
      integration: "pydantic-ai",
      feature: "gen-ui-tool-based",
      featureTypes: [featureType],
    },
    featureType,
    url: new URL("/demos/gen-ui-tool-based", baseURL).href,
    backendUrl: baseURL,
    testId: `canonical-rendering-${testInfo.workerIndex}-${Date.now()}`,
    surface: "direct-diagnostic",
  });
  await testInfo.attach("canonical-pill-execution", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.status, JSON.stringify(result)).toBe("passed");
});
