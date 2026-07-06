import { test, expect } from "@playwright/test";

// QA reference: qa/beautiful-chat.md
// Demo source: src/app/demos/beautiful-chat/**
// Route/runtime: src/app/api/copilotkit-beautiful-chat/route.ts
//   (dedicated combined runtime — openGenerativeUI + a2ui.injectA2UITool +
//    mcpApps — proxying to the hermes AG-UI adapter via HttpAgent)
// Fixtures: aimock/d6/hermes/beautiful-chat.json (context "hermes")
//
// Beautiful Chat is the flagship combined cell — a 1:1 port of
// integrations/langgraph-python/src/app/demos/beautiful-chat (the whole
// components/hooks/declarative-generative-ui subtree is byte-identical; it uses
// only transport-agnostic v2 hooks + the a2ui-renderer catalog). Two wiring
// divergences are forced by the hermes AG-UI transport (see the page + route
// headers and qa/beautiful-chat.md):
//   1. Shared `todos` state is written via the `manage_todos` state-writer tool
//      declared to the hermes adapter through `properties.stateWriterTools`.
//   2. `search_flights` is emitted as the middleware-injected `render_a2ui`
//      (a generic aimock agent cannot emit an agent-side tool RESULT the A2UI
//      middleware would detect).
//
// Structural parity with langgraph-python's beautiful-chat.spec.ts: same
// page-load + all-9-pills-render assertions, and the same user-facing signals
// for the agent-driven surfaces (html.dark flip, svg circles, recharts bars,
// FlightCard literals, HITL picker).
//
// DIVERGENCE — the agent-driven tests type the D5 probe prompts
// ("d5 beautiful-chat probe: ...") rather than clicking the suggestion pills.
// Under aimock the pills' suggestion messages ("Find flights from SFO to JFK
// for next Tuesday.", etc.) collide by substring with OTHER hermes cells'
// fixtures (e.g. the tool-rendering "Find flights from SFO to JFK." /
// "SFO to JFK" search_flights fixtures share the hermes context), so the same
// pill message would non-deterministically route to a different cell's tool.
// The D5 probe prompts are uniquely prefixed and collision-free, and are the
// exact strings the scheduled D5 probe family exercises — so this spec asserts
// the identical UI outcomes on the identical fixtures the probes use. The pill
// TITLES are still asserted verbatim (all-9-pills test), preserving pill parity.
//
// The 4 pills the D5 probe family intentionally excludes (Sales Dashboard,
// Excalidraw, Calculator, Task Manager) are covered live but excluded from the
// deterministic aimock suite for the reasons documented in
// harness/src/probes/scripts/_beautiful-chat-shared.ts and qa/beautiful-chat.md.

async function sendPrompt(page: import("@playwright/test").Page, text: string) {
  const input = page.getByPlaceholder("Type a message");
  await input.click();
  await input.fill(text);
  await input.press("Enter");
}

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
    // All 9 pills mount in the same render pass, so any one is a valid
    // readiness signal that hydration finished.
    await expect(
      page.getByRole("button", { name: "Toggle Theme (Frontend Tools)" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("page loads with logo, mode toggle, and chat input", async ({
    page,
  }) => {
    await expect(page.locator('img[alt="CopilotKit"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Chat", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "App", exact: true }),
    ).toBeVisible();
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
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("Toggle Theme flips the html class and runs the toggleTheme tool", async ({
    page,
  }) => {
    const html = page.locator("html");
    const initialClass = (await html.getAttribute("class")) ?? "";
    const initiallyDark = initialClass.includes("dark");

    await sendPrompt(page, "d5 beautiful-chat probe: toggle the theme");

    // Round-trip signal: the html `dark` class flips — proves the agent
    // responded AND the toggleTheme frontend tool fired. beautiful-chat tool
    // calls render in-transcript without a text bubble, so we assert on the
    // tool's observable side effect.
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

  test("Pie Chart renders a donut SVG with slice circles", async ({ page }) => {
    await sendPrompt(
      page,
      "d5 beautiful-chat probe: pie chart of revenue distribution by category",
    );

    // PieChart renders an inline <svg> with one background <circle> plus one
    // per data slice; the fixture ships 4 slices → at least 3 circles.
    const circles = page.locator("svg circle");
    await expect
      .poll(async () => await circles.count(), { timeout: 45000 })
      .toBeGreaterThanOrEqual(3);

    await expect(page.getByText(/\d+%/).first()).toBeVisible({ timeout: 5000 });
  });

  test("Bar Chart renders a recharts bar chart with rectangles", async ({
    page,
  }) => {
    await sendPrompt(
      page,
      "d5 beautiful-chat probe: bar chart of expenses by category",
    );

    const barChartRoot = page.locator(".recharts-responsive-container").first();
    await expect(barChartRoot).toBeVisible({ timeout: 45000 });

    const bars = page.locator(".recharts-bar-rectangle");
    await expect
      .poll(async () => await bars.count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(2);
  });

  test("Schedule Meeting renders the HITL time picker and confirms on select", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await sendPrompt(
      page,
      "d5 beautiful-chat probe: schedule a 30-minute meeting to learn about CopilotKit",
    );

    // scheduleTime is registered via useHumanInTheLoop → renders
    // MeetingTimePicker and pauses the agent until the user picks a slot.
    await expect(page.getByText("Pick a time that works for you")).toBeVisible({
      timeout: 60_000,
    });

    // Click the default "Tomorrow" slot to resolve the HITL; respond() fires,
    // the agent resumes, and the picker transitions to its confirmed state.
    await page.getByRole("button", { name: /Tomorrow/ }).click();
    await expect(page.getByText("Meeting Scheduled")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Search Flights renders FlightCard surface from A2UI fixed schema", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // hermes divergence: the agent emits the middleware-injected `render_a2ui`
    // with a flat FlightCard Row (identical shape to langgraph's
    // _build_flight_components) into copilotkit://app-dashboard-catalog. The
    // fixture ships United at $349 and Delta at $289; the airline names and
    // prices are inlined into each FlightCard as literal text.
    await sendPrompt(
      page,
      "d5 beautiful-chat probe: search flights from SFO to JFK",
    );

    await expect(page.getByText("United").first()).toBeVisible({
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

    // Regression guard: no A2UI render-error banners.
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
  });
});
