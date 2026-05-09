import { test, expect } from "@playwright/test";

// QA reference: qa/open-gen-ui-advanced.md
// Demo source: src/app/demos/open-gen-ui-advanced/{page.tsx,
//   sandbox-functions.ts, suggestions.ts}
// Aimock fixture: showcase/harness/fixtures/d5/gen-ui-open.json
//                 (bundled into showcase/aimock/d5-all.json)
//
// Advanced Open-Gen-UI: the sandboxed iframe can call two host-side
// sandbox functions via Websandbox.connection.remote.* — but those
// round-trips are intentionally NOT asserted here. Driving DOM inside
// the sandboxed iframe is unreliable (the sandbox="allow-scripts"-only
// attribute blocks cross-origin frame access from Playwright's host
// page, and the inner authored HTML varies between runs).
//
// Assertion bar: each pill click produces an iframe with a non-empty
// `srcdoc` (or `src`) — the open-gen-ui pipeline mounted SOMETHING.
// Whether the inner DOM correctly invokes evaluateExpression / notifyHost
// is deferred to a follow-up that adds a host-side spy on the runtime's
// `sandbox-function-call` event (or a same-origin sandbox option).
//
// Aimock priority note: each pill `message` string is a verbatim short
// label that matches a high-priority entry in `d5-all.json`. d5-all.json
// loads BEFORE feature-parity.json, so its first-match-wins ordering
// beats the broad `userMessage: "hi"` catch-all in feature-parity.json
// that would otherwise return the showcase-assistant boilerplate
// greeting. Keep pill message strings in `suggestions.ts` aligned with
// the fixture keys.

test.describe("Open Generative UI (advanced)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
  });

  test("page loads with chat composer and 3 suggestion pills", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15_000,
    });

    // Suggestion titles are verbatim from openGenUiSuggestions.
    const expected = [
      "Calculator",
      "Ping the host",
      "Inline expression evaluator",
    ];
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of expected) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });

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

  test("Inline expression evaluator pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "Inline expression evaluator");
  });

  test("Calculator pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "Calculator");
  });

  test("Ping the host pill renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await assertPillRendersIframe(page, "Ping the host");
  });
});
