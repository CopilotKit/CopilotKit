import { test, expect } from "@playwright/test";

// QA reference: qa/declarative-gen-ui.md
// Demo source: src/app/demos/declarative-gen-ui/{page.tsx, a2ui/*}
//
// Pattern: A2UI dynamic-schema BYOC. The frontend registers a 7-component
// catalog (Card, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart,
// BarChart) via `a2ui={{ catalog: myCatalog }}`. The Python ADK agent
// (`src/agents/declarative_gen_ui_agent.py`) owns the `generate_a2ui` tool
// (re-exported from `src/agents/main.py`) and emits an `a2ui_operations`
// container with `catalogId: "declarative-gen-ui-catalog"`. The secondary
// LLM inside `generate_a2ui` produces a JSON component tree that the A2UI
// renderer binds to the registered React catalog.
//
// There is no `data-testid` on the catalog renderers themselves — we rely
// on verbatim suggestion-pill text and the inline-style fingerprints
// exported by `a2ui/renderers.tsx` (donut SVG, recharts markers, brand
// lilac/mint palette). Because the secondary-LLM render is multi-step, the
// surface can take 30-60s to paint — render assertions use generous
// budgets.
//
// On Railway the `generate_a2ui` tool path can be slow / flaky — the KPI
// and StatusReport flows occasionally exceed a 60s budget when the
// secondary Gemini call stalls. Those two scenarios are skipped; the
// deterministic PieChart and BarChart catalog renderers are kept as the
// primary render-signal tests since they have the strongest visual
// fingerprints. Un-skip when the agent deployment stabilises.

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
    // <svg> with one background <circle> + one stroked <circle> per slice,
    // wrapped in `transform: scaleX(-1)`. The legend rows end in a
    // percentage like "45%". This is the strongest visual fingerprint of a
    // correctly-bound catalog PieChart node.
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions
      .filter({ hasText: "Pie chart — sales by region" })
      .first()
      .click();

    // At least background circle + 2 slice circles. 90s budget: on cold
    // starts the secondary-LLM `generate_a2ui` pass can eat most of a
    // minute before emitting the PieChart node.
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

    // Regression guard: assert no A2UI render-error banners are visible.
    // Catches both the "Cannot create component root without a type" loop
    // (LP #4734) and "Catalog not found" misconfigurations.
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

  // SKIP: KPI dashboard prompt drives `generate_a2ui` to emit a Card +
  // multiple Metric tiles. On Railway this path is the slowest of the 4
  // pills and regularly exceeds 60s when the secondary LLM stalls.
  test.skip("KPI dashboard pill renders at least 3 Metric tiles", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions
      .filter({ hasText: "Show a KPI dashboard" })
      .first()
      .click();

    // Each Metric renders an uppercase label with `letterSpacing: 0.12em`
    // above a large number. The label styling is the stable fingerprint;
    // the text content itself is model-generated and not asserted.
    const metricLabels = page.locator(
      'div[style*="letter-spacing: 0.12em"], div[style*="letterSpacing: 0.12em"]',
    );
    await expect
      .poll(async () => await metricLabels.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);
  });

  // SKIP: StatusReport prompt expects at least one Card + StatusBadge pill.
  // Same Railway slowness as KPI — often exceeds 60s.
  test.skip("Status report pill renders a Card with a StatusBadge pill", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions.filter({ hasText: "Status report" }).first().click();

    // StatusBadge style: `borderRadius: 999` (pill), uppercase + 0.1em
    // letter-spacing. This combo is unique to the badge renderer.
    const badges = page.locator(
      'span[style*="border-radius: 999"][style*="letter-spacing: 0.1em"], span[style*="borderRadius: 999"][style*="letterSpacing: 0.1em"]',
    );
    await expect
      .poll(async () => await badges.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(1);
  });
});
