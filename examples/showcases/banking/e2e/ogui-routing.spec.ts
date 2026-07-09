import { test, expect, type Page } from "@playwright/test";

// Deterministic (aimock-backed) routing guard for the adjacency set — the pills
// OGUI could plausibly steal. Curated pills must NOT open an OGUI iframe; OGUI
// pills must. Runs in OSS mode via playwright.ogui.config.ts (isolated ports).
//
// NUANCE: clicking a pill sends its `message` (not its `title`); aimock matches
// on userMessage = that message (see e2e/fixtures/ogui-routing.fixtures.json).
// Here we click by the pill TITLE (what the user sees). Keep these straight.

async function openChatAndClick(page: Page, pillText: string) {
  await page.goto("/");
  // The docked chat starts closed; CopilotSidebar's launcher is "Open chat".
  const launcher = page.getByRole("button", { name: /open chat/i });
  if (await launcher.count()) await launcher.first().click();
  // Wait for the chat to hydrate (input present) before clicking a pill, else
  // the click can land before React wires the pill's onClick and is dropped.
  await expect(page.getByPlaceholder(/type a message/i)).toBeVisible({
    timeout: 15_000,
  });
  const pill = page
    .getByTestId("copilot-suggestion")
    .filter({ hasText: pillText })
    .first();
  // The docked chat panel is pinned to the right edge, so its suggestion pills
  // land outside the viewport where Playwright's click (even force:true)
  // refuses to fire. Call the element's native click() — this drives React's
  // onClick (which sends the pill's `message` to the agent) regardless of
  // viewport position. Retry until the send registers (a user message bubble
  // appears), covering the race where an early click is dropped before
  // hydration completes.
  await expect(async () => {
    await pill.evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId("copilot-user-message").first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

const CURATED = [
  { pill: "Show the spending trend", heading: /spending trend/i },
  { pill: "Budgets near their limit?", heading: /budget usage/i },
  { pill: "Where is the money going?", heading: /spend breakdown/i },
  { pill: "How's our cash flow?", heading: /income vs expenses/i },
];

test.describe("OGUI routing — adjacency set", () => {
  for (const { pill, heading } of CURATED) {
    test(`curated pill "${pill}" renders its chart, not an OGUI iframe`, async ({
      page,
    }) => {
      await openChatAndClick(page, pill);
      // The curated chart renders inside an assistant message as an <h3> card
      // title. Scope to the transcript's assistant messages (not the pill row,
      // whose titles also contain these words). Match on the <h3> text rather
      // than role="heading": CopilotKit paints rendered tool output with
      // pointer-events/aria affordances that can drop the heading from the
      // accessibility tree, so getByRole("heading") is unreliable here.
      await expect(
        page
          .getByTestId("copilot-assistant-message")
          .locator("h3")
          .filter({ hasText: heading })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("ogui-surface")).toHaveCount(0);
      await expect(page.locator("iframe")).toHaveCount(0);
    });
  }

  test('boundary: "Build a spend report on the canvas" routes to render_report, not OGUI', async ({
    page,
  }) => {
    await openChatAndClick(page, "Build a spend report on the canvas");
    await expect(page.getByTestId("a2ui-surface")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("ogui-surface")).toHaveCount(0);
  });

  const OGUI = [
    "Build an interactive spend explorer",
    "Prototype a cash-flow what-if calculator",
  ];
  for (const pill of OGUI) {
    test(`OGUI pill "${pill}" renders on the canvas`, async ({ page }) => {
      await openChatAndClick(page, pill);
      const surface = page.getByTestId("ogui-surface");
      await expect(surface).toBeVisible({ timeout: 30_000 });
      await expect(surface.locator("iframe").first()).toBeVisible();
      // The OGUI handoff pill; use .first() since a thread may accumulate more
      // than one "rendered on the canvas" pill across exchanges (report + OGUI
      // both use this text), which would trip strict-mode's single-match rule.
      await expect(
        page.getByText(/rendered on the canvas/i).first(),
      ).toBeVisible();
    });
  }
});
