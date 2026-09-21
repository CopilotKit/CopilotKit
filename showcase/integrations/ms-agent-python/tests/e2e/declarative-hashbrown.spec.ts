import { createPlaywrightProbeExecutor } from "../../../../harness/src/probes/frontend-matrix-playwright.js";
import { buildTurns as buildCanonicalTurns } from "../../../../harness/src/probes/scripts/d5-byoc.js";
/**
 * E2E spec for the Declarative UI: Hashbrown demo. Selectors match the
 * chart/metric components' `data-testid` hooks. Covers 3 suggestion
 * flows + page-load smoke; timeouts are streaming-friendly because
 * hashbrown assembles UI progressively from structured output.
 */
import { test, expect } from "@playwright/test";

test.describe("@diagnostic Declarative UI: Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-hashbrown");
  });

  test("@diagnostic page loads with header, suggestion pills, and chat composer", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Declarative UI: Hashbrown" }),
    ).toBeVisible();
    await expect(page.getByText("Sales dashboard").first()).toBeVisible();
    await expect(page.getByText("Revenue by category").first()).toBeVisible();
    await expect(page.getByText("Expense trend").first()).toBeVisible();
  });

  test("@diagnostic sales-dashboard suggestion triggers a hashbrown render", async ({
    page,
  }) => {
    await page.getByText("Sales dashboard").first().click();

    const metricCard = page.locator('[data-testid="metric-card"]').first();
    const chart = page
      .locator('[data-testid="bar-chart"], [data-testid="pie-chart"]')
      .first();

    await expect(metricCard).toBeVisible({ timeout: 60000 });
    await expect(chart).toBeVisible({ timeout: 60000 });
  });

  test("@diagnostic revenue-by-category suggestion renders a pie chart", async ({
    page,
  }) => {
    await page.getByText("Revenue by category").first().click();
    await expect(page.locator('[data-testid="pie-chart"]').first()).toBeVisible(
      { timeout: 60000 },
    );
  });

  test("@diagnostic expense-trend suggestion renders a bar chart", async ({
    page,
  }) => {
    await page.getByText("Expense trend").first().click();
    await expect(page.locator('[data-testid="bar-chart"]').first()).toBeVisible(
      { timeout: 60000 },
    );
  });
});

/** Functional proof is this runner artifact; supplemental test totals are not acceptance. */
test("@canonical rendering declarative-hashbrown: all actual LGP pills and results", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(480_000);
  if (!baseURL)
    throw new Error(
      "canonical rendering requires configured actual demo baseURL",
    );
  const featureType = "byoc" as const;
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
      id: "react/ms-agent-python/declarative-hashbrown",
      frontend: "react",
      integration: "ms-agent-python",
      feature: "declarative-hashbrown",
      featureTypes: [featureType],
    },
    featureType,
    url: new URL("/demos/declarative-hashbrown", baseURL).href,
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
