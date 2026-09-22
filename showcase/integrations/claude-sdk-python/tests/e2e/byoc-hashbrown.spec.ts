import { createPlaywrightProbeExecutor } from "../../../../harness/src/probes/frontend-matrix-playwright.js";
import { buildTurns as buildCanonicalTurns } from "../../../../harness/src/probes/scripts/d5-byoc.js";
import { test, expect } from "@playwright/test";

test.describe("@diagnostic BYOC hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("@diagnostic header renders", async ({ page }) => {
    await expect(page.getByText("BYOC: Hashbrown")).toBeVisible();
  });

  test("@diagnostic chat composer is visible", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

/** Functional proof is this runner artifact; supplemental test totals are not acceptance. */
test("@canonical rendering byoc-hashbrown: all actual LGP pills and results", async ({
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
      id: "react/claude-sdk-python/byoc-hashbrown",
      frontend: "react",
      integration: "claude-sdk-python",
      feature: "byoc-hashbrown",
      featureTypes: [featureType],
    },
    featureType,
    url: new URL("/demos/byoc-hashbrown", baseURL).href,
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
