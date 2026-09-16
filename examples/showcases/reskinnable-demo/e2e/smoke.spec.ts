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
 *      brand, and switching between skins from the selector dropdown.
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
    // because the skin selector trigger also shows the active "Northwind Finance" brand.
    await expect(page.getByText("Northwind Finance").first()).toBeVisible();

    // The credit-cards page renders an h1 "Credit Cards" and an "Add Card"
    // dropdown — that's our credible-content check that the banking index is up.
    await expect(
      page.getByRole("heading", { name: "Credit Cards", level: 1 }),
    ).toBeVisible();

    // The chat is an inline CopilotChat inside the frame's assistant card, open by
    // default. There is no v2 launcher to assert: `copilot-chat-toggle` belonged to
    // CopilotSidebar and went away with it. The dismiss control lives in the
    // selector card with the other shell controls, so assert that instead — present
    // but NOT clicked, since clicking collapses the whole assistant column.
    await expect(page.getByTestId("sidebar-close")).toBeVisible();

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
 * its own brand, and the selector dropdown switches between them client-side.
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
    // selector trigger also shows the active "Northwind Finance" brand; the header brand
    // precedes the selector in DOM order.
    await expect(page.getByText("Northwind Finance").first()).toBeVisible();
    // No airline chrome leaked in. Stricter than it used to be: the selector is a
    // dropdown whose options only exist while open, so a correct banking page
    // contains NO "Aeronova" at all, rather than exactly one selector pill.
    await expect(page.getByText("Aeronova", { exact: true })).toHaveCount(0);
  });

  test("/airline renders the airline brand", async ({ page }) => {
    await page.goto("/airline");
    // Aeronova is the airline layout's sidebar brand; .first() picks it over the
    // selector trigger (layout precedes the selector in DOM order).
    await expect(page.getByText("Aeronova").first()).toBeVisible();
    // Content assertion that only holds when AirlineLayout + its index page
    // (TripsPage) actually rendered: the trips index paints an <h1>Your trip</h1>.
    // This is the real teeth of the test — the selector renders only brand
    // buttons (no heading), so it can never satisfy a heading query. A broken airline
    // index (resolvePage([]) → null → notFound()) renders Next's 404 INSIDE the still-
    // mounted SkinLayout, leaving the "Aeronova" selector trigger visible; the brand
    // assertion above would still pass, but this heading assertion would not.
    await expect(
      page.getByRole("heading", { name: "Your trip", level: 1 }),
    ).toBeVisible();
    // Symmetric negative guard (mirrors banking's Aeronova count): no banking chrome
    // leaked in, and with the selector closed there is no "Northwind Finance" at all.
    await expect(
      page.getByText("Northwind Finance", { exact: true }),
    ).toHaveCount(0);
  });

  test("unknown skins 404", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
  });

  test("the skin selector is present and switching skins navigates", async ({
    page,
  }) => {
    await page.goto("/banking");

    // The selector is a dropdown (see shell/layout/selector-card.tsx): the trigger
    // shows only the ACTIVE skin, and the options exist solely while it is open —
    // that is what keeps its footprint flat as skins are added. So each switch here
    // opens the menu first.
    const trigger = page.getByTestId("skin-selector-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("Northwind Finance");

    const openMenu = async () => {
      await trigger.click();
      await expect(page.getByTestId("skin-option-airline")).toBeVisible();
    };

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
    // <h1>Your trip</h1>, which no selector option can produce) AND that banking's
    // Credit Cards h1 is GONE. Asserting the trigger's own label would be weaker:
    // a bug where router.push changed the URL but SkinLayout failed to remount
    // (stale banking chrome left on screen) could still relabel the trigger. This
    // does not.
    await openMenu();
    await page.getByTestId("skin-option-airline").click();
    await expect(page).toHaveURL(/\/airline$/);
    await expect(airlineIndex).toBeVisible();
    await expect(bankingIndex).toHaveCount(0);
    await expect(trigger).toContainText("Aeronova");

    // And back: banking remounts (its index returns) and the airline chrome is gone.
    await trigger.click();
    await expect(page.getByTestId("skin-option-banking")).toBeVisible();
    await page.getByTestId("skin-option-banking").click();
    await expect(page).toHaveURL(/\/banking$/);
    await expect(bankingIndex).toBeVisible();
    await expect(airlineIndex).toHaveCount(0);
  });
});
