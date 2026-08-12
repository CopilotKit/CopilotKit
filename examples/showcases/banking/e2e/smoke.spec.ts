import { test, expect } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/**
 * CI-safe smoke test for the Northwind banking showcase.
 *
 * What this covers:
 *   1. App boots and the dashboard renders credible content (brand + cards UI).
 *   2. The CopilotKit v2 popup launcher opens the modal.
 *   3. The arc-leading suggestion pills (incl. the OGUI pill) are visible.
 *
 * What this intentionally does NOT do:
 *   - Send any chat message
 *   - Click any suggestion (which would invoke the agent / hit OpenAI)
 *   - Exercise any tool
 *
 * That keeps the test runnable in CI without secrets.
 */

// Console-error filtering: the page may legitimately log network errors for
// the /api/copilotkit endpoint (e.g. if the popup pings it on open and the
// runtime fails because OPENAI_API_KEY is a dummy value), and Next.js dev mode
// prints various non-fatal warnings. We only fail on genuine page/script
// errors that indicate the app itself is broken.
const IGNORED_ERROR_PATTERNS: RegExp[] = [
  /favicon/i,
  /\/api\/copilotkit/i,
  /Failed to load resource/i,
  /net::ERR_/i,
  /Download the React DevTools/i,
];

function isIgnoredError(message: ConsoleMessage): boolean {
  if (message.type() !== "error") return true;
  const text = message.text();
  return IGNORED_ERROR_PATTERNS.some((re) => re.test(text));
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isIgnoredError(msg)) {
      errors.push(msg.text());
    }
  });
  return errors;
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(err.stack ?? err.message);
  });
  return errors;
}

test.describe("banking showcase smoke", () => {
  test("dashboard renders and popup opens with suggestions", async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const pageErrors = collectPageErrors(page);

    await page.goto("/");

    // Brand assertion: the document title is the Northwind Finance brand.
    await expect(page).toHaveTitle(/Northwind/);

    // The credit-cards page renders an h1 "Credit Cards" and an "Add Card"
    // dropdown — that's our credible-content check that the dashboard is up.
    await expect(
      page.getByRole("heading", { name: "Credit Cards", level: 1 }),
    ).toBeVisible();

    // Open the CopilotKit popup. v2 renders a fixed launcher button with
    // data-testid="copilot-chat-toggle" (see CopilotChatToggleButton.tsx).
    const launcher = page.getByTestId("copilot-chat-toggle");
    await expect(launcher).toBeVisible();
    await launcher.click();

    // The popup modal exposes the configured assistant title as its aria-label
    // (modalHeaderTitle = IDENTITY.assistant = "Northwind Copilot"). We assert
    // on the dialog rather than visible text since the title may be rendered
    // as aria-only.
    await expect(
      page.getByRole("dialog", { name: /Northwind Copilot/i }),
    ).toBeVisible();

    // Pills configured by BankingSuggestions render as buttons with
    // data-testid="copilot-suggestion" (CopilotChatSuggestionPill.tsx). Assert
    // the arc-leading pills are present rather than a brittle exact count —
    // the pill catalog grows over time (curated charts, OGUI, cross-page ops).
    const suggestions = page.getByTestId("copilot-suggestion");
    await expect(suggestions.first()).toBeVisible();
    await expect(
      suggestions.filter({ hasText: "Approve the $5,000 Google Ads charge" }),
    ).toBeVisible();
    await expect(
      suggestions.filter({ hasText: "Review my pending transactions" }),
    ).toBeVisible();
    await expect(
      suggestions.filter({ hasText: "Build an interactive spend explorer" }),
    ).toBeVisible();

    // Make sure nothing genuinely broken showed up in the console while the
    // page rendered and the popup opened.
    expect(
      consoleErrors,
      `Unexpected console errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);

    // Uncaught exceptions don't always surface as console.error — pageerror is
    // the canonical "did the app crash?" hook. Any uncaught exception fails
    // the smoke test (no filtering).
    expect(
      pageErrors,
      `Unexpected uncaught page errors:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
  });
});
