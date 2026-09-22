import { test, expect } from "@playwright/test";

// QA reference: qa/declarative-gen-ui.md
// Demo source: src/app/demos/declarative-gen-ui/{page.tsx, a2ui/*}
//
// Pattern: A2UI dynamic-schema BYOC. The frontend registers a 7-component
// catalog (Card, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart,
// BarChart) via `a2ui={{ catalog: myCatalog }}`. The Python agent
// (`src/agents/a2ui_dynamic.py`) owns the `generate_a2ui` tool and emits an
// `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"`.
// The secondary LLM inside `generate_a2ui` produces a JSON component tree
// that the A2UI renderer binds to the registered React catalog.
//
// There is no `data-testid` in the demo source. We rely on verbatim
// suggestion-pill text and the inline-style fingerprints exported by
// `a2ui/renderers.tsx` (donut SVG, recharts markers, lilac/mint brand
// colours, etc.). Because the secondary-LLM render is multi-step, the
// surface can take 30-60s to paint — all render assertions use a 60s budget.
//
// W8-7 (resolved): KPI and StatusReport were skipped due to Railway
// slowness. The root cause was aimock fixtures returning content+toolCalls
// in one response — the frontend closed the assistant turn before the A2UI
// tool call rendered. Fixed by splitting fixtures (2436adba6); all 4 pills
// now test reliably with aimock.

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
      "Show a KPI dashboard",
      "Pie chart — sales by region",
      "Bar chart — quarterly revenue",
      "Status report",
    ];
    for (const title of expected) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test("PieChart pill renders a donut SVG with slice circles + legend %", async ({
    page,
  }) => {
    // The custom DonutChart renderer (a2ui/renderers.tsx) builds an inline
    // <svg> with one grey background <circle> + one stroked <circle> per
    // slice, wrapped in `transform: scaleX(-1)`. The legend rows end in a
    // percentage like "45%". This is the strongest visual fingerprint of a
    // correctly-bound catalog PieChart node.
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions
      .filter({ hasText: "Pie chart — sales by region" })
      .first()
      .click();

    // At least background circle + 2 slice circles. 90s budget: on
    // cold starts the secondary-LLM `generate_a2ui` pass can eat most
    // of a minute before emitting the PieChart node.
    const circles = page.locator("svg circle");
    await expect
      .poll(async () => await circles.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);

    // A legend row with an integer percentage (e.g. "45%").
    await expect(page.getByText(/\b\d+%/).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("BarChart pill renders a recharts bar chart with rectangles", async ({
    page,
  }) => {
    // BarChart renderer uses a recharts ResponsiveContainer (height 280) +
    // a custom shape (AnimatedBar with `barSlideIn` keyframe). We only
    // assert on stable recharts markers (class names unchanged across
    // versions) — the keyframe-specific CSS is a visual detail not worth
    // asserting via DOM.
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions
      .filter({ hasText: "Bar chart — quarterly revenue" })
      .first()
      .click();

    // 90s budget for the same cold-start reason as PieChart above.
    const barChartRoot = page.locator(".recharts-responsive-container").first();
    await expect(barChartRoot).toBeVisible({ timeout: 90_000 });

    // At least 2 bar rectangles should render. The custom shape renders a
    // recharts <Rectangle> inside a <g>, which keeps the standard class.
    const bars = page.locator(".recharts-bar-rectangle");
    await expect
      .poll(async () => await bars.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // Regression guard (#4734): the deployed KPI / dashboard pills used to
    // loop with "A2UI render error: Cannot create component root without a
    // type" because the secondary LLM's `render_a2ui` tool call was
    // intercepted by the A2UI middleware before our defensive validation
    // could drop malformed components. Renaming to `_design_a2ui_surface`
    // killed the bypass; assert no A2UI render-error banners are visible.
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);

    // Regression guard: only one bar chart surface (one ResponsiveContainer)
    // should render — looping renders would stack multiple.
    const allCharts = page.locator(".recharts-responsive-container");
    await expect
      .poll(async () => await allCharts.count(), { timeout: 5_000 })
      .toBeLessThanOrEqual(1);
  });

  test("KPI dashboard pill renders at least 3 Metric tiles", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions
      .filter({ hasText: "Show a KPI dashboard" })
      .first()
      .click();

    // Each Metric renderer emits `data-testid="declarative-metric"`.
    // The component tree is: label (uppercase) + value + optional trend arrow.
    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);
  });

  test("Status report pill renders a Card with a StatusBadge pill", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions.filter({ hasText: "Status report" }).first().click();

    // StatusBadge renderer emits `data-testid="declarative-status-badge"`.
    const badges = page.locator('[data-testid="declarative-status-badge"]');
    await expect
      .poll(async () => await badges.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(1);
  });
});
