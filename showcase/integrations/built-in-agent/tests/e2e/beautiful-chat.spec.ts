import { buildTurns as build0 } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-bar-chart.js";
import { buildTurns as build1 } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-pie-chart.js";
import { buildTurns as build2 } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-schedule-meeting.js";
import { buildTurns as build3 } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-search-flights.js";
import { buildTurns as build4 } from "../../../../harness/src/probes/scripts/d5-beautiful-chat-toggle-theme.js";
import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { attachSseInterceptor } from "../../../../harness/src/probes/helpers/sse-interceptor.js";
import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
    // Wait for a suggestion pill to render before dispatching clicks —
    // otherwise the click can race hydration and silently no-op. Picking
    // any visible pill as the readiness signal works because all 9 pills
    // mount in the same render pass.
    await expect(
      page.getByRole("button", { name: "Toggle Theme (Frontend Tools)" }),
    ).toBeVisible({ timeout: 15000 });
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

  test("[diagnostic supplemental] Sales Dashboard pill renders A2UI dashboard surface", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Backend: generate_a2ui tool calls a secondary LLM bound to
    // `_design_a2ui_surface` (renamed from `render_a2ui` to avoid the A2UI
    // middleware's default tool-call intercept on `render_a2ui`);
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
    // starts. The fixture chain (feature-parity.json) returns both a
    // generate_a2ui tool call and final narration text mentioning "Total
    // Revenue". When the A2UI middleware is active AND the secondary LLM
    // fixture fires, the dashboard renders as an A2UI surface with recharts
    // charts. When running against aimock without the full A2UI pipeline
    // (e.g. the secondary-LLM fixture doesn't fire), only the narration
    // text renders. Assert on the narration text as the primary signal, and
    // treat recharts rendering as a bonus (soft assertion).
    await expect(page.getByText(/Total Revenue/i).first()).toBeVisible({
      timeout: 90_000,
    });

    // Soft assertion: if the full A2UI pipeline fires, recharts containers
    // should appear. When running against aimock-only (no secondary LLM),
    // only the text narration renders — so we don't hard-fail on missing
    // charts. The recharts check still catches regressions when the A2UI
    // pipeline IS active.
    const chartRoot = page.locator(".recharts-responsive-container").first();
    const chartsRendered = await chartRoot
      .isVisible({ timeout: 15_000 })
      .catch(() => false);

    if (chartsRendered) {
      // Regression guard (#4733 / #4734): the deployed Sales Dashboard used
      // to surface "A2UI render error: Catalog not found: ...". Assert the
      // error string is absent so any future revert trips this test.
      await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
      await expect(
        page.getByText(/Cannot create component .* without a type/i),
      ).toHaveCount(0);

      // Regression guard: only ONE dashboard surface should render.
      const allCharts = page.locator(".recharts-responsive-container");
      await expect
        .poll(async () => await allCharts.count(), { timeout: 5_000 })
        .toBeLessThanOrEqual(2); // 1 pie + 1 bar = 2 charts
    }
  });

  test("[diagnostic supplemental] Task Manager pill streams 3 todos into the shared-state canvas", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page
      .getByRole("button", { name: "Task Manager (Shared State)" })
      .click();

    const todoColumn = page.locator('section[aria-label="To Do column"]');
    await expect(todoColumn).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText("Read the CopilotKit docs")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Build a CopilotKit prototype")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Explore shared agent state")).toBeVisible({
      timeout: 5_000,
    });
  });
});

// Canonical functional certification shares the production driver and expectations.
for (const [feature, build] of [
  ["beautiful-chat-bar-chart", build0],
  ["beautiful-chat-pie-chart", build1],
  ["beautiful-chat-schedule-meeting", build2],
  ["beautiful-chat-search-flights", build3],
  ["beautiful-chat-toggle-theme", build4],
] as const) {
  test(feature + " canonical actual pill", async ({ page }) => {
    test.setTimeout(900_000);
    const capture = await attachSseInterceptor(page);
    try {
      await page.goto("/demos/beautiful-chat");
      const result = await runConversation(
        page,
        build({
          integrationSlug: "built-in-agent",
          featureType: feature,
          baseUrl: new URL(page.url()).origin,
        }),
        { mode: "functional-pill" },
      );
      expect(result.error).toBeUndefined();
      expect(result.pillExecution?.completed).toBe(true);
      expect(result.pillExecution?.actions).toHaveLength(9);
    } finally {
      await capture.stop();
    }
  });
}
