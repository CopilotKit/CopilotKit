import { test, expect } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/**
 * CI-safe smoke test for the reskinnable showcase.
 *
 * The app is now a shell hosting multiple skins: every page lives under
 * /<skin>, and `/` 307-redirects to the default skin (/banking). The banking
 * index (/banking) is the Credit Cards page.
 *
 * What this covers:
 *   1. The banking index boots and renders credible content (brand + cards UI).
 *   2. The docked CopilotKit v2 chat is present, titled with the assistant name.
 *   3. The arc-leading banking suggestion pills are visible.
 *   4. The reskinning itself: the / redirect, both skins rendering their own
 *      brand, and switching between skins from the floating selector.
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
  test("banking index renders and the docked chat shows its suggestions", async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const pageErrors = collectPageErrors(page);

    // Go straight to the banking skin rather than leaning on the / redirect —
    // a failure here localises to the page, not the redirect (which has its own
    // test below).
    await page.goto("/banking");

    // Brand assertion: the banking chrome shows the Northwind Finance brand.
    // The document <title> is now the shell-generic "CopilotKit Reskinnable
    // Demo" (the shell owns <head>, not the skin), so the per-skin brand lives
    // in the layout header — assert the rendered brand there. Scope to .first()
    // because the floating skin selector also carries a "Northwind Finance" pill.
    await expect(page.getByText("Northwind Finance").first()).toBeVisible();

    // The credit-cards page renders an h1 "Credit Cards" and an "Add Card"
    // dropdown — that's our credible-content check that the banking index is up.
    await expect(
      page.getByRole("heading", { name: "Credit Cards", level: 1 }),
    ).toBeVisible();

    // The chat is now a docked CopilotSidebar that starts OPEN by default (see
    // shell/chat/chat-panel.tsx: defaultOpen + a one-time setModalOpen(true) on
    // mount) — it is no longer a popup that begins closed. The v2 launcher
    // (data-testid="copilot-chat-toggle") is therefore a CLOSE control here, so
    // we assert it exists but do NOT click it (clicking would collapse the panel;
    // it is also overlapped by the floating skin selector). The panel is present
    // on load, so its contents are asserted directly.
    await expect(page.getByTestId("copilot-chat-toggle")).toBeVisible();

    // The docked panel's custom header carries the configured assistant title
    // (modalHeaderTitle = IDENTITY.assistant = "Northwind Copilot"). Scope to the
    // header testid: the welcome message also contains "Northwind Copilot", so an
    // unscoped text match would be ambiguous.
    await expect(page.getByTestId("chat-panel-header")).toContainText(
      "Northwind Copilot",
    );

    // The banking suggestion pills render inside the docked panel's custom
    // suggestion view (shell/chat/demo-suggestions.tsx), each as a button with
    // data-testid="demo-suggestion-<index>" showing the suggestion's TITLE — not
    // the framework's default copilot-suggestion pill. Assert a couple of
    // arc-leading pills from the current catalog (src/skins/banking/suggestions.ts)
    // rather than a brittle exact count.
    const suggestions = page.locator('[data-testid^="demo-suggestion-"]');
    await expect(suggestions.first()).toBeVisible();
    await expect(
      suggestions.filter({ hasText: "Show the spending trend" }),
    ).toBeVisible();
    await expect(
      suggestions.filter({ hasText: "Approve the $15,000 AWS charge" }),
    ).toBeVisible();

    // Make sure nothing genuinely broken showed up in the console while the
    // page rendered and the docked chat mounted.
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

/**
 * Reskinning smoke: the app's headline feature. One shell, many skins — every
 * page lives under /<skin>, `/` redirects to the default skin, each skin paints
 * its own brand, and the floating selector switches between them client-side.
 *
 * These are CI-safe: they never open the chat or invoke the agent, so they need
 * no secrets and no LLM/memory backend.
 */
test.describe("reskinning", () => {
  test("/ redirects to the default skin (/banking)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/banking$/);
  });

  test("/banking renders the banking brand", async ({ page }) => {
    await page.goto("/banking");
    // Northwind Finance is the banking layout's brand line. .first() because the
    // floating selector also carries a "Northwind Finance" pill; the header brand
    // precedes the selector in DOM order.
    await expect(page.getByText("Northwind Finance").first()).toBeVisible();
    // No airline chrome leaked in: the Aeronova sidebar brand is banking-absent
    // (the only "Aeronova" on this page is the selector pill, which is a button).
    await expect(page.getByText("Aeronova", { exact: true })).toHaveCount(1);
  });

  test("/airline renders the airline brand", async ({ page }) => {
    await page.goto("/airline");
    // Aeronova is the airline layout's sidebar brand; .first() picks it over the
    // selector pill (layout precedes the selector in DOM order).
    await expect(page.getByText("Aeronova").first()).toBeVisible();
    // Content assertion that only holds when AirlineLayout + its index page
    // (TripsPage) actually rendered: the trips index paints an <h1>Your trip</h1>.
    // This is the real teeth of the test — the floating selector renders only brand
    // buttons (no heading), so it can never satisfy a heading query. A broken airline
    // index (resolvePage([]) → null → notFound()) renders Next's 404 INSIDE the still-
    // mounted SkinLayout, leaving the "Aeronova" selector pill visible; the brand
    // assertion above would still pass, but this heading assertion would not.
    await expect(
      page.getByRole("heading", { name: "Your trip", level: 1 }),
    ).toBeVisible();
    // Symmetric negative guard (mirrors banking's Aeronova count): no banking chrome
    // leaked in — the only "Northwind Finance" on this page is the selector pill.
    await expect(
      page.getByText("Northwind Finance", { exact: true }),
    ).toHaveCount(1);
  });

  test("unknown skins 404", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
  });

  test("the floating selector is present and switching skins navigates", async ({
    page,
  }) => {
    await page.goto("/banking");

    // The floating selector lists every registered skin as a brand-labelled
    // button (see shell/floating-selector.tsx). Both skins' pills are present.
    const toBanking = page.getByRole("button", { name: /Northwind Finance/i });
    const toAirline = page.getByRole("button", { name: /Aeronova/i });
    await expect(toBanking).toBeVisible();
    await expect(toAirline).toBeVisible();

    // Baseline: the banking skin is mounted, so its Credit Cards index h1 is up.
    const bankingIndex = page.getByRole("heading", {
      name: "Credit Cards",
      level: 1,
    });
    const airlineIndex = page.getByRole("heading", {
      name: "Your trip",
      level: 1,
    });
    await expect(bankingIndex).toBeVisible();

    // Switch to the airline skin. Assert the URL changed AND that the shell actually
    // remounted the airline skin, by checking real airline chrome (the trips
    // <h1>Your trip</h1>, which no selector pill can produce) AND that banking's
    // Credit Cards h1 is GONE. Re-asserting the "Aeronova" pill would be a no-op: it
    // was already visible before the click, so a bug where router.push changed the
    // URL but SkinLayout failed to remount (stale banking chrome left on screen)
    // would still pass. This does not.
    await toAirline.click();
    await expect(page).toHaveURL(/\/airline$/);
    await expect(airlineIndex).toBeVisible();
    await expect(bankingIndex).toHaveCount(0);

    // And back: banking remounts (its index returns) and the airline chrome is gone.
    await toBanking.click();
    await expect(page).toHaveURL(/\/banking$/);
    await expect(bankingIndex).toBeVisible();
    await expect(airlineIndex).toHaveCount(0);
  });
});
