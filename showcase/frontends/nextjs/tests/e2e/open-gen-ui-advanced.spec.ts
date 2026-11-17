import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/open-gen-ui-advanced/{demo.tsx,
//   sandbox-functions.ts, suggestions.ts}
// Aimock fixtures: showcase/aimock/d6/<slug>/ (entries keyed by the
//   verbatim suggestion `message` strings)
//
// Advanced Open-Gen-UI: each prompt triggers a deterministic
// `generateSandboxedUi` tool call whose `jsFunctions` wire in-iframe click
// handlers to the two host-side sandbox functions registered in
// `sandbox-functions.ts` via `Websandbox.connection.remote.*`.
//
// Two layers of assertions:
//   1. SMOKE: each prompt produces an iframe with a non-empty `srcdoc`.
//      Confirms the open-gen-ui pipeline mounted SOMETHING.
//   2. ROUND-TRIP: driving the iframe's buttons fires the host-side
//      handler (seen through the handler's `console.log`) AND updates the
//      iframe's output element with the host response. Confirms that the
//      fixture's `jsFunctions` is wired correctly. Catches a fixture that
//      ships HTML + CSS only, where every button is a silent no-op.
//
// Driving the iframe works because the fixture HTML is deterministic
// (stable `#hi`, `#in`, `#go`, `#eq`, `#d`, `#out` selectors), and
// Playwright `frameLocator` can interact with `sandbox="allow-scripts"`
// iframes through CDP regardless of the null origin.
//
// The tests send each prompt by filling the textarea and pressing Enter,
// not by clicking a suggestion pill. Pill clicks proved timing-flaky in
// the headless-complete probe (commit 15db0bbf3). A pill click and Enter in
// the textarea send the same message, so the fixture matcher catches
// either route, and the textarea is always there.
//
// Aimock note: each prompt is a short verbatim label that matches a
// fixture entry for this demo. A prompt that does not match falls through
// to the broad catch-all fixture, which answers with the showcase
// assistant's greeting. Keep the pill messages in `suggestions.ts` aligned
// with the fixture keys.

// Verbatim `message` values from suggestions.ts.
const PROMPTS = {
  calculator: "Calculator (calls evaluateExpression)",
  ping: "Ping the host (calls notifyHost)",
  inlineEval: "Inline expression evaluator",
};

// The handlers in `sandbox-functions.ts` log to the host console with this
// prefix.
const HOST_LOG_PREFIX = "[open-gen-ui/advanced]";

async function sendPromptAndAwaitIframe(page: Page, prompt: string) {
  // Use the stable test id, not getByPlaceholder: the composer textarea
  // attaches onKeyDown only after React hydration. The explicit click
  // focuses the textarea and waits for it before fill, so Enter is not a
  // no-op.
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
}

// Collects the host console lines of one sandbox function. Playwright's
// `page.on("console")` sees them even though the call starts inside the
// sandboxed iframe, because the handler runs on the host page.
function captureHostHandlerLogs(page: Page, needle: string) {
  const logs: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes(HOST_LOG_PREFIX) && text.includes(needle)) {
      logs.push(text);
    }
  });
  return logs;
}

function sandboxFrame(page: Page) {
  return page.frameLocator('iframe[sandbox*="allow-scripts"]').first();
}

describeDemo("open-gen-ui-advanced", "Open Generative UI (advanced)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("open-gen-ui-advanced"));
    // Wait for React hydration. Before hydration, the textarea has no
    // keydown handler, so Enter does nothing and the iframe never mounts.
    // Network idle is a best-effort signal: a page that never goes idle
    // still runs the test.
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

    // Suggestion titles, verbatim from openGenUiSuggestions.
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

  const smokeCases = [
    { name: "Inline expression evaluator", prompt: PROMPTS.inlineEval },
    { name: "Calculator", prompt: PROMPTS.calculator },
    { name: "Ping the host", prompt: PROMPTS.ping },
  ];
  for (const { name, prompt } of smokeCases) {
    test(`${name} prompt renders a sandboxed iframe with non-empty source`, async ({
      page,
    }) => {
      await sendPromptAndAwaitIframe(page, prompt);
    });
  }

  // Round-trip tests: drive the in-iframe controls and check that the
  // host-side sandbox-function handler ran.

  test("Ping the host prompt: in-iframe click fires host notifyHost handler", async ({
    page,
  }) => {
    const hostLogs = captureHostHandlerLogs(page, "notifyHost");

    await sendPromptAndAwaitIframe(page, PROMPTS.ping);

    const frame = sandboxFrame(page);
    await frame.locator("#hi").click();

    await expect
      .poll(() => hostLogs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    expect(hostLogs.some((l) => l.includes("Hello from sandbox"))).toBe(true);

    // The iframe's output element must show the host's `receivedAt` reply.
    await expect(frame.locator("#out")).toContainText("host replied at", {
      timeout: 10_000,
    });
  });

  test("Inline expression evaluator prompt: typing + clicking Evaluate fires host evaluateExpression handler", async ({
    page,
  }) => {
    const hostLogs = captureHostHandlerLogs(page, "evaluateExpression");

    await sendPromptAndAwaitIframe(page, PROMPTS.inlineEval);

    const frame = sandboxFrame(page);
    // `fill()` silently does nothing inside sandbox="allow-scripts" iframes
    // on some Playwright/Chromium combinations (the null origin blocks the
    // set-value protocol message). `pressSequentially` sends single key
    // events, which reach the input regardless of the sandbox.
    const input = frame.locator("#in");
    await input.click();
    await input.pressSequentially("2+2");
    await frame.locator("#go").click();

    await expect
      .poll(() => hostLogs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // The handler logs `evaluateExpression <expr> = <value>`.
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

    const frame = sandboxFrame(page);
    // Build `2+3`, then evaluate. Each digit and operator is its own
    // <button>, and `=` has id="eq".
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
