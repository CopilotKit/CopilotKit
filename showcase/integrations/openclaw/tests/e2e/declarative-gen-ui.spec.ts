import { test, expect } from "@playwright/test";

// Behavioral e2e for the declarative-gen-ui demo (OpenClaw), run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so these
// prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// Pattern: A2UI dynamic-schema BYOC. The page registers a custom catalog
// (Card, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart, BarChart) via
// `<CopilotKit a2ui={{ catalog: myCatalog }}>` (catalogId
// "declarative-gen-ui-catalog") and renders a plain `CopilotChat`. The runtime
// at /api/copilotkit-declarative-gen-ui injects the `render_a2ui` tool; the
// OpenClaw gateway forwards it to the model, which calls it with
// {surfaceId, catalogId, components[]} — one component id:"root". The frontend
// catalog renders the surface; each renderer carries a stable data-testid
// (declarative-card, -metric, -status-badge, -pie-chart, -bar-chart, -info-row).
//
// OpenClaw tool-loop specifics (see chat.json _comment): clawg-ui flattens the
// whole AG-UI conversation into one user prompt, so the render_a2ui tool result
// arrives as text "Tool render_a2ui returned: ..." rather than a role:tool
// message. aimock's hasToolResult discriminator therefore never fires on the
// follow-up; the FIRST fixture in chat.json (userMessage:"returned:") is the
// TERMINATOR that closes the loop with plain text. So each A2UI pill needs ONE
// tool-call fixture (userMessage substring + toolName:render_a2ui +
// hasToolResult:false) and relies on the shared "returned:" terminator for the
// follow-up.
//
// The suggestion pills are wired via useConfigureSuggestions (available:"always")
// and render as buttons — we drive them with getByRole("button", { name })
// matching the other OpenClaw specs (agentic-chat, frontend-tools).
//
// PieChart is a custom SVG donut (<circle> slices), NOT recharts — assert on
// the declarative-pie-chart testid + its <circle> elements. BarChart uses
// recharts (.recharts-bar-rectangle markers are stable across versions).
test.describe("Declarative Generative UI (A2UI dynamic schema)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
  });

  test("page loads with a chat input and no surface rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    // No A2UI surface on first paint.
    await expect(page.getByTestId("declarative-card")).toHaveCount(0);
    await expect(page.getByTestId("declarative-metric")).toHaveCount(0);
    await expect(page.getByTestId("declarative-pie-chart")).toHaveCount(0);
    await expect(page.getByTestId("declarative-bar-chart")).toHaveCount(0);
  });

  test("all four suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    for (const title of [
      "Show a KPI dashboard",
      "Pie chart — sales by region",
      "Bar chart — quarterly revenue",
      "Status report",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("KPI dashboard pill renders a Card with Metric tiles", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Show a KPI dashboard" }).click();

    // The fixture emits render_a2ui with a Card > Column of 3 Metrics.
    const card = page.locator('[data-testid="declarative-card"]');
    await expect(card.first()).toBeVisible({ timeout: 90_000 });

    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);

    // Fixture-specific values so the fixture demonstrably drives the run.
    await expect(page.getByText("Revenue").first()).toBeVisible();
    await expect(page.getByText("$1.2M").first()).toBeVisible();
    await expect(page.getByText("Churn").first()).toBeVisible();

    // No A2UI render-error banners.
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
  });

  test("pie chart pill renders a donut PieChart surface", async ({ page }) => {
    await page
      .getByRole("button", { name: "Pie chart — sales by region" })
      .click();

    const pie = page.locator('[data-testid="declarative-pie-chart"]');
    await expect(pie.first()).toBeVisible({ timeout: 90_000 });

    // The PieChart renderer draws a custom SVG donut: one background <circle>
    // plus one slice <circle> per datum (fixture has 4 slices -> >= 5 circles).
    const circles = pie.locator("svg circle");
    await expect
      .poll(async () => await circles.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    // Fixture-specific title + a legend label.
    await expect(page.getByText("Sales by Region").first()).toBeVisible();
    await expect(page.getByText("North America").first()).toBeVisible();

    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
  });

  test("bar chart pill renders a recharts BarChart surface", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Bar chart — quarterly revenue" })
      .click();

    const bar = page.locator('[data-testid="declarative-bar-chart"]');
    await expect(bar.first()).toBeVisible({ timeout: 90_000 });

    // recharts bar-rectangle markers are stable across versions; the fixture
    // has 4 quarters.
    const bars = page.locator(".recharts-bar-rectangle");
    await expect
      .poll(async () => await bars.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    await expect(page.getByText("Quarterly Revenue").first()).toBeVisible();
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
  });

  test("status report pill renders StatusBadge pills", async ({ page }) => {
    await page.getByRole("button", { name: "Status report" }).click();

    // One StatusBadge per service (API, database, background workers).
    const badges = page.locator('[data-testid="declarative-status-badge"]');
    await expect
      .poll(async () => await badges.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);

    // Fixture-specific badge text.
    await expect(page.getByText(/API: healthy/i).first()).toBeVisible();
    await expect(
      page.getByText(/Background Workers: degraded/i).first(),
    ).toBeVisible();

    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
  });
});
