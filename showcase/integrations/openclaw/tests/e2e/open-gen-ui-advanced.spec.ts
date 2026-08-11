import { test, expect } from "@playwright/test";

// Behavioral e2e for the open-gen-ui-advanced demo (OpenClaw), run against
// aimock (deterministic LLM). The gateway injects X-AIMock-Context: openclaw.
//
// This demo (src/app/demos/open-gen-ui-advanced/) mounts a v2 CopilotChat wired
// to the `open-gen-ui-advanced` agent on the isolated `/api/copilotkit-ogui`
// runtime. That runtime enables `openGenerativeUI: { agents: [...] }`, which
// injects a `generateSandboxedUi` tool and converts each call into an
// `open-generative-ui` activity event; the built-in
// `OpenGenerativeUIActivityRenderer` mounts the agent-authored HTML + CSS +
// jsFunctions inside a sandboxed iframe (`sandbox="allow-scripts"`). The
// jsFunctions call two host-side sandbox functions registered in
// `sandbox-functions.ts` via `Websandbox.connection.remote.*`:
//   - evaluateExpression({expression}) -> { ok, value }
//   - notifyHost({message})            -> { ok, receivedAt, message }
// Both log to the host console with a stable `[open-gen-ui/advanced]` prefix.
//
// aimock matching (OpenClaw specifics): the runtime-injected
// `generateSandboxedUi` tool is present in every request for this agent, so the
// tool fixtures match on toolName + hasToolResult:false. Because ag-ui
// FLATTENS the AG-UI conversation into a single user prompt, aimock's role:tool
// discriminator never fires on the follow-up; the shared "returned:" TERMINATOR
// fixture (chat.json #0) intercepts the flattened tool-result marker and closes
// the tool turn. So only the first-call tool fixtures are needed here.
//
// Prompts are the verbatim `message` strings from suggestions.ts (they double
// as fixture keys). Fixtures live in showcase/aimock/d4/openclaw/chat.json.
//
// Two layers of assertions, mirroring the hermes reference spec:
//   1. SMOKE     — each prompt produces an iframe with non-empty source.
//   2. ROUND-TRIP — driving the iframe's controls fires the host-side handler
//      (observed via its console.log) AND updates the iframe output. Catches a
//      fixture that ships HTML+CSS only where every button is a silent no-op.
//
// Composer drive note: OpenClaw's v2 CopilotChat exposes the composer as
// getByPlaceholder("Type a message") (see agentic-chat / frontend-tools specs).
// We fill + Enter rather than clicking a suggestion pill to avoid the
// EmptyState-vs-SuggestionBar mount race; chip click and textarea Enter both
// dispatch the same runAgent, so the fixture matcher catches either route.

// Verbatim `message` values from
// src/app/demos/open-gen-ui-advanced/suggestions.ts.
const PROMPTS = {
  calculator: "Calculator (calls evaluateExpression)",
  ping: "Ping the host (calls notifyHost)",
  inlineEval: "Inline expression evaluator",
};

test.describe("Open Generative UI (advanced)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
    // Wait for React hydration: without this the composer's keydown handler
    // may not be attached when fill+Enter runs, making Enter a no-op.
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
  });

  test("page loads with chat composer and the three suggestion pills", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20_000,
    });

    // Suggestion titles are verbatim from openGenUiSuggestions.
    for (const title of [
      "Calculator",
      "Ping the host",
      "Inline expression evaluator",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  const sendPromptAndAwaitIframe = async (
    page: import("@playwright/test").Page,
    prompt: string,
  ) => {
    const input = page.getByPlaceholder("Type a message");
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.click();
    await input.fill(prompt);
    await input.press("Enter");

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

  // ── Smoke: each prompt mounts a sandboxed iframe ────────────────────

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

  // ── Round-trip: in-iframe controls fire the host-side handler ───────
  //
  // The handlers in sandbox-functions.ts log to the host console with a stable
  // `[open-gen-ui/advanced]` prefix; Playwright's page.on('console') catches
  // those even though the click originates inside the sandboxed iframe (the
  // handler runs on the host page).

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
    // Handler logs `notifyHost: <message>` — the fixture's jsFunctions send
    // "Hello from sandbox".
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
    // `fill()` can silently no-op inside sandbox="allow-scripts" iframes (null
    // origin blocks the set-value protocol message). `pressSequentially` sends
    // key events that always reach the input regardless of sandbox
    // restrictions.
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
    // Build `2+3` then evaluate. Each digit/operator is a separate <button>;
    // `=` has id="eq"; the display has id="d".
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
