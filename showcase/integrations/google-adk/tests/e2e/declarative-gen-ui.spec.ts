import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// QA reference: qa/declarative-gen-ui.md
// Demo source: src/app/demos/declarative-gen-ui/{page.tsx, a2ui/*}
//
// Pattern: A2UI dynamic-schema BYOC. The frontend registers a custom catalog
// (Row, Column, Card, StatusBadge, Metric, InfoRow, DataTable, PrimaryButton,
// PieChart, BarChart) via `a2ui={{ catalog: myCatalog }}`. The agent plays a
// sales analyst for the fictional "Vantage Threads" company; the dataset and
// per-question composition rules are registered as agent context in
// `declarative-gen-ui/sales-context.ts`. Suggestion pills are natural
// business questions — chart-type steering lives in the agent system prompt,
// not the user prompt (OSS-136).
//
// Each renderer carries a stable `data-testid` (declarative-card, -metric,
// -pie-chart, -bar-chart, -status-badge, -data-table, -info-row). Because
// the secondary-LLM render is multi-step, the surface can take 30-60s to
// paint — render assertions use a 90s budget.
//
// W8-7 (resolved): aimock fixtures must split content and toolCalls into
// separate responses — a combined response closes the assistant turn before
// the A2UI tool call renders (see 2436adba6).

/** Click a suggestion pill and confirm the message actually dispatched
 *  (the user bubble with the pill's full message text appears). On slow
 *  dev-server hydration the first click can land before the chat send
 *  pipeline is wired and is silently swallowed — retry until the bubble
 *  shows up.
 *
 *  The "dispatched" assertion is scoped to the chat-message list
 *  (`[data-message-role="user"]`), NOT a bare `getByText` — the pill
 *  button itself contains the message text, so an unscoped match would
 *  satisfy the locator with the pill rather than the resulting user
 *  bubble, neutering the dispatch guard. Before each retry we also
 *  check whether the user bubble already exists; if it does the
 *  earlier click DID dispatch and we must NOT re-click (which would
 *  send a duplicate user message). */
async function clickPill(page: Page, title: string, message: string) {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const userBubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: message })
    .first();
  await expect(async () => {
    // If the previous attempt's click already produced the user bubble,
    // skip the click — re-clicking dispatches a duplicate user message.
    if ((await userBubble.count()) === 0) {
      await pill.click();
    }
    await expect(userBubble).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("Declarative Generative UI (A2UI dynamic schema)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
  });

  test("page loads with chat input and no surface rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // No A2UI surface rendered on first paint (no donut SVG, no recharts
    // container).
    await expect(page.locator(".recharts-responsive-container")).toHaveCount(0);
  });

  test("all 4 suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    const expected = [
      "Show my sales dashboard",
      "Team performance",
      "Anything at risk?",
      "Top account details",
    ];
    for (const title of expected) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test("sales dashboard pill renders a composed surface: KPI strip + pie + bar (no surrounding card)", async ({
    page,
  }) => {
    await clickPill(
      page,
      "Show my sales dashboard",
      "Show me my sales dashboard for this quarter.",
    );

    // The hero surface must contain a 4-tile KPI Metric row AND both
    // charts (no surrounding Card — the charts carry their own card
    // chrome). Composition rule (sales-context.ts) + D5 probe + aimock
    // fixtures all pin the hero at 4 Metric tiles. A single lonely
    // widget is the regression OSS-136 was filed about. 90s budget: on
    // cold starts the secondary-LLM `generate_a2ui` pass can eat most
    // of a minute.
    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(4);

    // PieChart: recharts donut (mirrors beautiful-chat's sales dashboard) —
    // one sector path per slice.
    const pie = page.locator('[data-testid="declarative-pie-chart"]');
    await expect(pie.first()).toBeVisible({ timeout: 60_000 });
    const sectors = pie.locator(".recharts-pie-sector");
    await expect
      .poll(async () => await sectors.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // BarChart: recharts markers are stable across versions.
    const bar = page.locator('[data-testid="declarative-bar-chart"]');
    await expect(bar.first()).toBeVisible({ timeout: 60_000 });
    const bars = page.locator(".recharts-bar-rectangle");
    await expect
      .poll(async () => await bars.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // Regression guard (#4734): no A2UI render-error banners (malformed
    // secondary-LLM output used to loop with "Cannot create component root
    // without a type").
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);

    // Regression guard: exactly one composed surface — pie + bar each use a
    // ResponsiveContainer, so the hero dashboard yields exactly 2.
    // Fewer = under-composed surface (a lonely chart, OSS-136 regression);
    // more = looping/duplicated renders.
    const allCharts = page.locator(".recharts-responsive-container");
    await expect
      .poll(async () => await allCharts.count(), { timeout: 5_000 })
      .toEqual(2);

    // Composition rule (OSS-136 — QA `qa/declarative-gen-ui.md`): the hero
    // dashboard has NO surrounding Card. The charts carry their own card
    // chrome, so wrapping them in an extra Card is a planner-side
    // over-composition regression. Assert zero `declarative-card` mounts.
    await expect(page.getByTestId("declarative-card")).toHaveCount(0);
  });

  test("team performance pill renders a DataTable with rep rows", async ({
    page,
  }) => {
    await clickPill(
      page,
      "Team performance",
      "How are our sales reps performing against quota?",
    );

    const table = page.locator('[data-testid="declarative-data-table"]');
    await expect(table.first()).toBeVisible({ timeout: 90_000 });

    // At least 2 body rows — a header-only table is an under-specified
    // surface (the planner forgot the `rows` prop).
    const rows = table.locator("tbody tr");
    await expect
      .poll(async () => await rows.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // The surface is dashboardy, not a bare table: a quota-attainment
    // BarChart accompanies it.
    await expect(
      page.locator('[data-testid="declarative-bar-chart"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("at-risk pill renders StatusBadge pills", async ({ page }) => {
    await clickPill(
      page,
      "Anything at risk?",
      "Are any accounts or pipeline deals at risk this quarter?",
    );

    // One severity badge per at-risk account (3 in the dataset).
    const badges = page.locator('[data-testid="declarative-status-badge"]');
    await expect
      .poll(async () => await badges.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);

    // The surface is a risk panel, not bare cards: a KPI strip of three
    // tiles (ARR at risk / accounts at risk / biggest exposure) leads
    // it. QA + composition rule require all three — fewer is an
    // under-specified surface.
    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    // Composition rule (QA `qa/declarative-gen-ui.md`): the at-risk pill
    // renders StatusBadge cards + a KPI strip — NO charts or tables.
    // Any chart/table mount here is a planner over-composition regression.
    await expect(page.getByTestId("declarative-pie-chart")).toHaveCount(0);
    await expect(page.getByTestId("declarative-bar-chart")).toHaveCount(0);
    await expect(page.getByTestId("declarative-data-table")).toHaveCount(0);
  });

  test("top account pill renders InfoRow facts", async ({ page }) => {
    await clickPill(
      page,
      "Top account details",
      "Pull up the details on our biggest account.",
    );

    // The account card stacks label/value facts (owner, region, ARR,
    // renewal, last contact) — require at least 3 InfoRows.
    const infoRows = page.locator('[data-testid="declarative-info-row"]');
    await expect
      .poll(async () => await infoRows.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);

    // The surface is dashboardy, not a bare fact list: a product-line
    // PieChart accompanies it.
    await expect(
      page.locator('[data-testid="declarative-pie-chart"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Composition rule (QA `qa/declarative-gen-ui.md`): the top-account
    // pill renders a Card of InfoRow facts + a product-line PieChart —
    // NO DataTable, NO StatusBadge. Either is a planner over-composition
    // regression.
    await expect(page.getByTestId("declarative-data-table")).toHaveCount(0);
    await expect(page.getByTestId("declarative-status-badge")).toHaveCount(0);
  });
});
