import { createPlaywrightProbeExecutor } from "../../../../harness/src/probes/frontend-matrix-playwright.js";
import { buildTurns as buildCanonicalTurns } from "../../../../harness/src/probes/scripts/d5-gen-ui-open.js";
import { test, expect } from "@playwright/test";

// QA reference: qa/open-gen-ui.md
// Demo source: src/app/demos/open-gen-ui/{page.tsx,suggestions.ts}
// Aimock fixture: showcase/harness/fixtures/d5/gen-ui-open.json
//                 (bundled into showcase/aimock/d5-all.json)
//
// Open-Ended Generative UI (minimal). The agent streams a single
// `generateSandboxedUi` tool call; the runtime middleware at
// `/api/copilotkit-ogui` converts the stream into `open-generative-ui`
// activity events which the built-in `OpenGenerativeUIActivityRenderer`
// mounts inside a sandboxed `<iframe sandbox="allow-scripts">`.
//
// Assertion bar: iframe presence + non-empty `srcdoc` (or `src`). We do
// NOT introspect iframe DOM via `contentFrame()` — sandbox="allow-scripts"
// without `allow-same-origin` blocks cross-origin frame access from the
// host, and the inner authored HTML varies between runs. "Renders
// something" means the host successfully populated an iframe; whether
// the inner HTML is correct is out of scope here.
//
// Aimock priority note: each pill `message` string is a verbatim short
// label that matches a high-priority entry in `d5-all.json`. d5-all.json
// loads BEFORE feature-parity.json, so its first-match-wins ordering
// beats the broad `userMessage: "hi"` catch-all in feature-parity.json
// that would otherwise return the showcase-assistant boilerplate
// greeting (and never emit the open-gen-ui tool call). Keep the pill
// message strings in `suggestions.ts` aligned with the fixture keys.

test.describe("@diagnostic Open Generative UI (minimal)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("@diagnostic page loads with chat composer and 4 suggestion pills", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15_000,
    });

    // Suggestion titles are verbatim from minimalSuggestions in suggestions.ts.
    const expected = [
      "3D axis visualization",
      "How a neural network works",
      "Quicksort visualization",
      "Fourier: square wave from sines",
    ];
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of expected) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  // Helper: click a pill and assert that a sandboxed iframe mounts with
  // a non-empty source attribute. `srcdoc` is the expected attribute
  // (the renderer composes the HTML+CSS into srcdoc); fall back to `src`
  // for completeness.
  const assertPillRendersIframe = async (
    page: import("@playwright/test").Page,
    pillTitle: string,
  ) => {
    const suggestion = page
      .locator('[data-testid="copilot-suggestion"]', { hasText: pillTitle })
      .first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();

    const iframe = page.locator('iframe[sandbox*="allow-scripts"]').first();
    await expect(iframe).toBeVisible({ timeout: 60_000 });

    // Either srcdoc (preferred — the renderer composes HTML into srcdoc)
    // or src must be present and non-empty.
    await expect
      .poll(
        async () => {
          const srcdoc = await iframe.getAttribute("srcdoc");
          if (srcdoc && srcdoc.length > 0) return true;
          const src = await iframe.getAttribute("src");
          if (src && src.length > 0) return true;
          return false;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  };

  test("@diagnostic Fourier pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "Fourier: square wave from sines");
  });

  test("@diagnostic 3D axis pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "3D axis visualization");
  });

  test("@diagnostic Neural network pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "How a neural network works");
  });

  test("@diagnostic Quicksort pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "Quicksort visualization");
  });
});

/** Functional proof is this runner artifact; supplemental test totals are not acceptance. */
test("@canonical rendering open-gen-ui: all actual LGP pills and results", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(480_000);
  if (!baseURL)
    throw new Error(
      "canonical rendering requires configured actual demo baseURL",
    );
  const featureType = "gen-ui-open" as const;
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
      id: "react/google-adk/open-gen-ui",
      frontend: "react",
      integration: "google-adk",
      feature: "open-gen-ui",
      featureTypes: [featureType],
    },
    featureType,
    url: new URL("/demos/open-gen-ui", baseURL).href,
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
