import { test, expect } from "@playwright/test";

// QA reference: qa/open-gen-ui-advanced.md
// Demo source: src/app/demos/open-gen-ui-advanced/{page.tsx,
//   sandbox-functions.ts, suggestions.ts}
// Aimock fixture: showcase/aimock/d5-all.json (entries keyed by the
//                 verbatim suggestion `message` strings)
//
// Advanced Open-Gen-UI: each prompt triggers a deterministic
// `generateSandboxedUi` tool call whose `jsFunctions` wires in-iframe
// click handlers to the two host-side sandbox functions registered in
// `sandbox-functions.ts` via `Websandbox.connection.remote.*`.
//
// Two layers of assertions:
//   1. SMOKE — each prompt produces an iframe with a non-empty `srcdoc`.
//      Confirms the open-gen-ui pipeline mounted SOMETHING.
//   2. ROUND-TRIP — driving the iframe's buttons fires the host-side
//      handler (observed via the handler's `console.log`) AND updates
//      the iframe's output element with the host response. Confirms
//      the fixture's `jsFunctions` is wired correctly. Catches the
//      regression where a fixture ships HTML+CSS only and every button
//      becomes a silent no-op.
//
// Iframe driving works because the fixture HTML is deterministic
// (stable `#hi`, `#in`, `#go`, `#eq`, `#d`, `#out` selectors) and
// Playwright `frameLocator` can interact with `sandbox="allow-scripts"`
// iframes via CDP regardless of the null origin.
//
// Composer drive note: we send the prompt by filling the textarea and
// pressing Enter rather than clicking a suggestion pill. The demo has
// two chip surfaces (EmptyState vs SuggestionBar) whose mount depends
// on `messages.length`, which makes pill clicks timing-flaky — see
// commit 15db0bbf3 (gen-ui-headless-complete: drive via textarea, not
// chip click). Chip-click and textarea-Enter dispatch the same
// `runAgent`, so the fixture matcher catches either route and the
// textarea is always present.
//
// Aimock priority note: each pill `message` string is a verbatim short
// label that matches a high-priority entry in `d5-all.json`. d5-all.json
// loads BEFORE feature-parity.json, so its first-match-wins ordering
// beats the broad `userMessage: "hi"` catch-all in feature-parity.json
// that would otherwise return the showcase-assistant boilerplate
// greeting. Keep pill message strings in `suggestions.ts` aligned with
// the fixture keys.

// Verbatim `message` values from src/app/demos/open-gen-ui-advanced/suggestions.ts.
const PROMPTS = {
  calculator: "Calculator (calls evaluateExpression)",
  ping: "Ping the host (calls notifyHost)",
  inlineEval: "Inline expression evaluator",
};

test.describe("Open Generative UI (advanced)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
    // Wait for React hydration: without this the textarea's keydown
    // handler may not yet be attached when fill+Enter runs, so the
    // Enter press becomes a no-op and the iframe never mounts.
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
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

  const sendPromptAndAwaitIframe = async (
    page: import("@playwright/test").Page,
    prompt: string,
  ) => {
    // Use the stable testid (not getByPlaceholder): the chat composer's
    // textarea wires onKeyDown only after React hydration, and the
    // testid locator + an explicit click force focus + handler attach
    // before fill, preventing a flaky Enter-as-no-op race.
    const textarea = page.locator('[data-testid="copilot-chat-textarea"]');
    await expect(textarea).toBeVisible({ timeout: 15_000 });
    await textarea.click();
    await textarea.fill(prompt);
    await textarea.press("Enter");

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

  test("Inline expression evaluator prompt renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await sendPromptAndAwaitIframe(page, PROMPTS.inlineEval);
  });

  test("Calculator prompt renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await sendPromptAndAwaitIframe(page, PROMPTS.calculator);
  });

  test("Ping the host prompt renders a sandboxed iframe with non-empty source", async ({
    page,
  }) => {
    await sendPromptAndAwaitIframe(page, PROMPTS.ping);
  });

  // ── Round-trip tests ────────────────────────────────────────────────
  //
  // Drive the in-iframe controls and assert the host-side sandbox-function
  // handler ran. The handlers in `sandbox-functions.ts` log to the host
  // console with a stable `[open-gen-ui/advanced]` prefix; Playwright's
  // `page.on('console')` catches those even though the call originates
  // inside the sandboxed iframe (the handler runs on the host page).

  const captureHostHandlerLogs = (
    page: import("@playwright/test").Page,
    needle: string,
  ): string[] => {
    const logs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[open-gen-ui/advanced]") && text.includes(needle)) {
        logs.push(text);
      }
    });
    return logs;
  };

  test("Ping the host prompt: in-iframe click fires host notifyHost handler", async ({
    page,
  }) => {
    const hostLogs = captureHostHandlerLogs(page, "notifyHost");

    await sendPromptAndAwaitIframe(page, PROMPTS.ping);

    const frame = page.frameLocator('iframe[sandbox*="allow-scripts"]').first();
    await frame.locator("#hi").click();

    await expect
      .poll(() => hostLogs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    expect(hostLogs.some((l) => l.includes("Hello from sandbox"))).toBe(true);

    // Iframe output element must reflect the host's `receivedAt` reply.
    await expect(frame.locator("#out")).toContainText("host replied at", {
      timeout: 10_000,
    });
  });

  test("Inline expression evaluator prompt: typing + clicking Evaluate fires host evaluateExpression handler", async ({
    page,
  }) => {
    const hostLogs = captureHostHandlerLogs(page, "evaluateExpression");

    await sendPromptAndAwaitIframe(page, PROMPTS.inlineEval);

    const frame = page.frameLocator('iframe[sandbox*="allow-scripts"]').first();
    // `fill()` silently no-ops inside sandbox="allow-scripts" iframes on
    // some Playwright/Chromium combos (null origin blocks the set-value
    // protocol message). `pressSequentially` sends individual key events
    // that always reach the input regardless of sandbox restrictions.
    const input = frame.locator("#in");
    await input.click();
    await input.pressSequentially("2+2");
    await frame.locator("#go").click();

    await expect
      .poll(() => hostLogs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // Handler logs `evaluateExpression <expr> = <value>` — verify the value.
    expect(hostLogs.some((l) => /=\s*4\b/.test(l))).toBe(true);

    await expect(frame.locator("#out")).toContainText("= 4", {
      timeout: 10_000,
    });
  });

  test("Calculator prompt: digit + operator + '=' fires host evaluateExpression handler", async ({
    page,
  }) => {
    const hostLogs = captureHostHandlerLogs(page, "evaluateExpression");

    await sendPromptAndAwaitIframe(page, PROMPTS.calculator);

    const frame = page.frameLocator('iframe[sandbox*="allow-scripts"]').first();
    // Build `2+3` then evaluate. Each digit/operator is a separate
    // <button>; `=` has id="eq".
    await frame.getByRole("button", { name: "2", exact: true }).click();
    await frame.getByRole("button", { name: "+", exact: true }).click();
    await frame.getByRole("button", { name: "3", exact: true }).click();
    await frame.locator("#eq").click();

    await expect
      .poll(() => hostLogs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    expect(hostLogs.some((l) => /=\s*5\b/.test(l))).toBe(true);

    await expect(frame.locator("#d")).toHaveText("5", { timeout: 10_000 });
  });
});
