import { createPlaywrightProbeExecutor } from "../../../../harness/src/probes/frontend-matrix-playwright.js";
import { buildTurns as buildCanonicalTurns } from "../../../../harness/src/probes/scripts/d5-byoc.js";
import { test, expect } from "@playwright/test";

test.describe("@diagnostic BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("@diagnostic page loads with chat composer", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("@diagnostic suggestion pills are rendered", async ({ page }) => {
    await expect(
      page.getByText("Sales dashboard", { exact: false }).first(),
    ).toBeVisible({
      timeout: 10000,
    });
  });
});

/** Functional proof is this runner artifact; supplemental test totals are not acceptance. */
test("@canonical rendering byoc-json-render: all actual LGP pills and results", async ({
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
      id: "react/claude-sdk-python/byoc-json-render",
      frontend: "react",
      integration: "claude-sdk-python",
      feature: "byoc-json-render",
      featureTypes: [featureType],
    },
    featureType,
    url: new URL("/demos/byoc-json-render", baseURL).href,
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
