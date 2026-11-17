import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Declarative Generative UI (A2UI, dynamic schema). The page registers the
// sales dashboard catalog (Row, Column, Text, Card, StatusBadge, Metric,
// InfoRow, DataTable, PrimaryButton, PieChart, BarChart). The agent plays a
// sales analyst for the fictional "Vantage Threads" company; the dataset and
// the composition rules reach it as agent context. The pills ask business
// questions, and the composition rules pick the components.
//
// Each renderer has a stable `data-testid` (declarative-card, -metric,
// -pie-chart, -bar-chart, -status-badge, -data-table, -info-row). The
// secondary render is multi-step, so a surface can take 30-60s to paint:
// render assertions allow 90s.
//
// The aimock fixtures must send content and tool calls as separate
// responses. A combined response closes the assistant turn before the A2UI
// tool call renders.

/** Clicks a suggestion pill and waits until its message is sent: the user
 *  bubble with the pill's full message appears. During slow hydration the
 *  first click can land before the chat can send, and is lost, so it retries.
 *
 *  The check looks for the user bubble (`copilot-user-message`), not for the
 *  bare text: the pill itself contains the message text. Before each retry it
 *  also checks whether the bubble already exists, because clicking again
 *  would send a duplicate message. */
async function clickPill(page: Page, title: string, message: string) {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const userBubble = page
    .locator('[data-testid="copilot-user-message"]')
    .filter({ hasText: message })
    .first();
  await expect(async () => {
    if ((await userBubble.count()) === 0) {
      await pill.click();
    }
    await expect(userBubble).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

describeDemo(
  "declarative-gen-ui",
  "Declarative Generative UI (A2UI dynamic schema)",
  () => {
    test.setTimeout(120_000);

    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("declarative-gen-ui"));
    });

    test("page loads with chat input and no surface rendered", async ({
      page,
    }) => {
      await expect(page.getByPlaceholder("Type a message")).toBeVisible();
      // No A2UI surface on first paint (no Recharts container).
      await expect(page.locator(".recharts-responsive-container")).toHaveCount(
        0,
      );
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
        await expect(
          suggestions.filter({ hasText: title }).first(),
        ).toBeVisible({ timeout: 15_000 });
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

      // The dashboard has a row of 4 Metric tiles and both charts. The
      // composition rules and the fixtures pin it at 4 tiles; a lone widget
      // is the regression this guards against.
      const metrics = page.locator('[data-testid="declarative-metric"]');
      await expect
        .poll(async () => await metrics.count(), { timeout: 90_000 })
        .toBeGreaterThanOrEqual(4);

      // PieChart: a Recharts donut with one sector per slice.
      const pie = page.locator('[data-testid="declarative-pie-chart"]');
      await expect(pie.first()).toBeVisible({ timeout: 60_000 });
      const sectors = pie.locator(".recharts-pie-sector");
      await expect
        .poll(async () => await sectors.count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);

      // BarChart: the Recharts class names are stable across versions.
      const bar = page.locator('[data-testid="declarative-bar-chart"]');
      await expect(bar.first()).toBeVisible({ timeout: 60_000 });
      const bars = page.locator(".recharts-bar-rectangle");
      await expect
        .poll(async () => await bars.count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);

      // No A2UI render-error banners. Malformed secondary output used to
      // loop with "Cannot create component root without a type".
      await expect(
        page.getByText(/Cannot create component .* without a type/i),
      ).toHaveCount(0);
      await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);

      // Exactly one composed surface: the pie and the bar each use a
      // ResponsiveContainer, so the dashboard has exactly 2. Fewer means an
      // under-composed surface, more means duplicated renders.
      const allCharts = page.locator(".recharts-responsive-container");
      await expect
        .poll(async () => await allCharts.count(), { timeout: 5_000 })
        .toEqual(2);

      // The dashboard has no surrounding Card: the charts carry their own
      // card chrome, so an extra Card is over-composition.
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

      // At least 2 body rows. A table with only a header means the `rows`
      // prop is missing.
      const rows = table.locator("tbody tr");
      await expect
        .poll(async () => await rows.count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);

      // A quota-attainment BarChart comes with the table.
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

      // A row of three KPI tiles (ARR at risk, accounts at risk, biggest
      // exposure) leads the risk panel.
      const metrics = page.locator('[data-testid="declarative-metric"]');
      await expect
        .poll(async () => await metrics.count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(3);

      // The risk panel has StatusBadge cards and KPI tiles only. A chart or
      // a table here is over-composition.
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
      // renewal, last contact): at least 3 InfoRows.
      const infoRows = page.locator('[data-testid="declarative-info-row"]');
      await expect
        .poll(async () => await infoRows.count(), { timeout: 90_000 })
        .toBeGreaterThanOrEqual(3);

      // A product-line PieChart comes with the facts.
      await expect(
        page.locator('[data-testid="declarative-pie-chart"]').first(),
      ).toBeVisible({ timeout: 15_000 });

      // The account panel has InfoRow facts and a PieChart only. A
      // DataTable or a StatusBadge here is over-composition.
      await expect(page.getByTestId("declarative-data-table")).toHaveCount(0);
      await expect(page.getByTestId("declarative-status-badge")).toHaveCount(0);
    });
  },
);
