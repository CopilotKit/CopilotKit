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
 *  shows up. */
async function clickPill(page: Page, title: string, message: string) {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    await pill.click();
    await expect(page.getByText(message).first()).toBeVisible({
      timeout: 3_000,
    });
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

  test("sales dashboard pill renders a composed surface: card + metrics + pie + bar", async ({
    page,
  }) => {
    await clickPill(
      page,
      "Show my sales dashboard",
      "Show me my sales dashboard for this quarter.",
    );

    // The hero surface must contain a titled Card with a KPI Metric row
    // AND both charts — a single lonely widget is the regression OSS-136
    // was filed about. 90s budget: on cold starts the secondary-LLM
    // `generate_a2ui` pass can eat most of a minute.
    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);

    await expect(
      page.locator('[data-testid="declarative-card"]').first(),
    ).toBeVisible({ timeout: 15_000 });

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
    // ResponsiveContainer, so a single hero dashboard yields at most 2.
    // Looping renders would stack more.
    const allCharts = page.locator(".recharts-responsive-container");
    await expect
      .poll(async () => await allCharts.count(), { timeout: 5_000 })
      .toBeLessThanOrEqual(2);
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
  });

  test("at-risk pill renders StatusBadge pills", async ({ page }) => {
    await clickPill(
      page,
      "Anything at risk?",
      "Are any accounts or pipeline deals at risk this quarter?",
    );

    const badges = page.locator('[data-testid="declarative-status-badge"]');
    await expect
      .poll(async () => await badges.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(1);
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
  });
});
