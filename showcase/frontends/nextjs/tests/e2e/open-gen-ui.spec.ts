import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/open-gen-ui/{demo.tsx,suggestions.ts}
// Aimock fixtures: showcase/aimock/d6/<slug>/gen-ui-open.json
//
// Open-Ended Generative UI (minimal). The agent streams a single
// `generateSandboxedUi` tool call. The runtime middleware (enabled by
// `openGenerativeUI` in src/demo-runtime-options.ts) converts the stream
// into `open-generative-ui` activity events, which the built-in
// `OpenGenerativeUIActivityRenderer` mounts inside a sandboxed
// `<iframe sandbox="allow-scripts">`.
//
// Assertion bar: the iframe is present and has a non-empty `srcdoc` (or
// `src`). The tests do NOT read the iframe DOM with `contentFrame()`:
// sandbox="allow-scripts" without `allow-same-origin` blocks frame access
// from the host, and the authored HTML varies between runs. "Renders
// something" means the host filled an iframe. Whether the inner HTML is
// correct is out of scope here.
//
// Aimock note: each pill `message` is a short verbatim label that matches
// a fixture entry for this demo. A message that does not match falls
// through to the broad catch-all fixture, which answers with the showcase
// assistant's greeting and never calls the tool. Keep the pill messages in
// `suggestions.ts` aligned with the fixture keys.

// Suggestion titles, verbatim from minimalSuggestions in suggestions.ts.
const PILLS = [
  { name: "3D axis", title: "3D axis visualization" },
  { name: "Neural network", title: "How a neural network works" },
  { name: "Quicksort", title: "Quicksort visualization" },
  { name: "Fourier", title: "Fourier: square wave from sines" },
];

function suggestionPill(page: Page, title: string) {
  return page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
}

// Clicks a pill and checks that a sandboxed iframe mounts with a non-empty
// source. The renderer puts the HTML + CSS into `srcdoc`. `src` is the
// fallback.
async function expectPillRendersIframe(page: Page, pillTitle: string) {
  const suggestion = suggestionPill(page, pillTitle);
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await suggestion.click();

  const iframe = page.locator('iframe[sandbox*="allow-scripts"]').first();
  await expect(iframe).toBeVisible({ timeout: 60_000 });

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
}

describeDemo("open-gen-ui", "Open Generative UI (minimal)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("open-gen-ui"));
  });

  test("page loads with chat composer and 4 suggestion pills", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15_000,
    });

    for (const { title } of PILLS) {
      await expect(suggestionPill(page, title)).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  for (const { name, title } of PILLS) {
    test(`${name} pill renders a sandboxed iframe with non-empty source`, async ({
      page,
    }) => {
      await expectPillRendersIframe(page, title);
    });
  }
});
