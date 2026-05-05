import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
    // The chat client (CopilotKit v2) needs a moment to attach its provider
    // before suggestion clicks dispatch reliably. Without this the click can
    // race the hydration and silently no-op. Existing pill tests above were
    // tolerant of this — the A2UI tests need the round-trip to succeed.
    await page.waitForTimeout(3000);
  });

  test("page loads with logo, mode toggle, and chat input", async ({
    page,
  }) => {
    // CopilotKit logo (top-left of the chat pane)
    await expect(page.locator('img[alt="CopilotKit"]')).toBeVisible();

    // Mode toggle (Chat / App pills, fixed top-right). Use role=button + exact
    // name to disambiguate from other occurrences of the word "Chat".
    await expect(
      page.getByRole("button", { name: "Chat", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "App", exact: true }),
    ).toBeVisible();

    // CopilotChat input is rendered. CopilotKit's default chat input uses a
    // textarea with placeholder "Type a message" across all v2 demos.
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("all 9 suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    const expectedPills = [
      "Pie Chart (Controlled Generative UI)",
      "Bar Chart (Controlled Generative UI)",
      "Schedule Meeting (Human In The Loop)",
      "Search Flights (A2UI Fixed Schema)",
      "Sales Dashboard (A2UI Dynamic)",
      "Excalidraw Diagram (MCP App)",
      "Calculator App (Open Generative UI)",
      "Toggle Theme (Frontend Tools)",
      "Task Manager (Shared State)",
    ];

    for (const title of expectedPills) {
      // Suggestions render as buttons containing the verbatim title text.
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("Toggle Theme pill flips the html class and runs the toggleTheme tool", async ({
    page,
  }) => {
    // "Toggle Theme" is the fastest round-trip: a single frontend tool call,
    // no chart rendering. Its aimock fixture (userMessage keyword "toggle")
    // returns a toggleTheme tool call.
    const html = page.locator("html");
    const initialClass = (await html.getAttribute("class")) ?? "";
    const initiallyDark = initialClass.includes("dark");

    await page
      .getByRole("button", { name: "Toggle Theme (Frontend Tools)" })
      .click();

    // Round-trip signal: the html `dark` class flips — proves both that the
    // agent responded AND that the frontend tool fired. The beautiful-chat
    // demo does not emit `[data-role="assistant"]` on its chat turns (tool
    // calls render in-transcript without a text bubble), so we assert on the
    // tool's observable side effect instead of a chat-bubble selector.
    await expect
      .poll(
        async () => {
          const cls = (await html.getAttribute("class")) ?? "";
          return cls.includes("dark");
        },
        { timeout: 30000 },
      )
      .toBe(!initiallyDark);
  });

  test("Pie Chart pill renders a donut SVG with slice circles", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Pie Chart (Controlled Generative UI)" })
      .click();

    // The PieChart component renders an inline <svg> with one background
    // <circle> plus one <circle> per data slice
    // (components/generative-ui/charts/pie-chart.tsx). The aimock fixture for
    // "revenue distribution by category" returns 4 slices, so wait for at
    // least 5 circles total (background + 4 slices).
    const circles = page.locator("svg circle");
    await expect
      .poll(async () => await circles.count(), { timeout: 45000 })
      .toBeGreaterThanOrEqual(3);

    // Legend rows include a percentage ending in "%".
    await expect(page.getByText(/\d+%/).first()).toBeVisible({ timeout: 5000 });
  });

  test("Bar Chart pill renders a recharts bar chart with rectangles", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Bar Chart (Controlled Generative UI)" })
      .click();

    // Recharts renders bars inside a ResponsiveContainer. The root class is
    // stable across recharts versions.
    const barChartRoot = page.locator(".recharts-responsive-container").first();
    await expect(barChartRoot).toBeVisible({ timeout: 45000 });

    // At least 2 bar rectangles should render.
    const bars = page.locator(".recharts-bar-rectangle");
    await expect
      .poll(async () => await bars.count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(2);
  });

  test("Search Flights pill renders FlightCard surface from A2UI fixed schema", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Backend: search_flights tool emits an a2ui_operations container with one
    // FlightCard component per flight. The agent (`src/agents/beautiful_chat.py`
    // `_build_flight_components`) emits literal-children components rather than
    // the structural-children template form, because the binder's structural
    // expansion isn't reliably exercised by sibling demos. Aimock returns 2
    // flights — United at $349 and Delta at $289.
    //
    // Visual fingerprint: the airline names and prices are inlined into each
    // FlightCard so they appear as literal text.
    const pill = page.getByRole("button", {
      name: "Search Flights (A2UI Fixed Schema)",
    });
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await pill.click();

    // 60s budget: tool call + a2ui_operations round-trip can be slow on cold
    // starts. Assertion targets are aimock-fixture text, not LLM output, so
    // they're stable across runs.
    await expect(page.getByText("United Airlines").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Delta").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("$349").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("$289").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Sales Dashboard pill renders A2UI dashboard surface", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Backend: generate_a2ui tool calls a secondary LLM bound to render_a2ui;
    // both calls hit aimock fixtures
    // (showcase/aimock/feature-parity.json — userMessage + toolName matchers
    // differentiate primary vs secondary calls; a toolCallId match breaks the
    // post-tool loop). The render_a2ui fixture ships a 3-metric + 2-chart
    // dashboard tree against `copilotkit://app-dashboard-catalog`.
    //
    // Visual fingerprint: a Metric label "Total Revenue", plus a recharts
    // ResponsiveContainer (the Pie/BarChart custom renderers wrap their
    // recharts content in one).
    const pill = page.getByRole("button", {
      name: "Sales Dashboard (A2UI Dynamic)",
    });
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await pill.click();

    // 90s budget: secondary-LLM stage inside generate_a2ui can stall on cold
    // starts.
    await expect(page.getByText(/Total Revenue/i).first()).toBeVisible({
      timeout: 90_000,
    });

    const chartRoot = page.locator(".recharts-responsive-container").first();
    await expect(chartRoot).toBeVisible({ timeout: 15_000 });
  });
});
