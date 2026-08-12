import { test, expect } from "@playwright/test";

/**
 * A2UI report canvas E2E.
 *
 * Proves the render_report → a2ui-surface → full-screen canvas handoff: an
 * assistant turn calls the backend `render_report` tool with a small selection
 * (which KPIs/charts); the tool builds A2UI ops, the A2UIMiddleware turns them
 * into an `a2ui-surface` activity, the chat shows a "rendered on the canvas"
 * pill, and LayoutComponent swaps the dashboard body out for <ReportCanvas/>
 * (data-testid="a2ui-surface"), which reads the ops from the agent message
 * stream and renders them against the banking catalog with live client data.
 *
 * ── HOW render_report BECOMES AN a2ui-surface ACTIVITY (verified) ────────────────
 * The runtime sets `a2ui: { injectA2UITool: false }` on both variants
 * (src/app/api/copilotkit/[[...slug]]/route.ts) and registers a backend tool
 * `render_report` on the BuiltInAgent whose `execute` returns
 * `{ a2ui_operations: [...] }` (built deterministically by
 * src/a2ui/build-report-ops.ts). With injectA2UITool:false the middleware
 * detects that `a2ui_operations` container in the tool result
 * (tryParseA2UIOperations) and emits the a2ui-surface activity. The model only
 * emits the tiny render_report selection — it never authors component JSON.
 *
 * ── REQUIRED aimock FIXTURE (not yet wired — see test.fixme below) ───────────────
 * aimock mocks ONLY the LLM, so the fixture just emits the render_report tool
 * call; the real backend `execute` runs and builds the ops. It must be loaded by
 * the aimock server (e2e/aimock-server.mjs), which currently hardcodes only
 * fixtures/memory-learning.fixtures.json — wiring this is the remaining step:
 *
 *   {
 *     "match": { "userMessage": "spend report on the canvas", "turnIndex": 0 },
 *     "response": { "toolCalls": [{
 *       "name": "render_report",
 *       "arguments": {
 *         "title": "Spend report",
 *         "kpis": ["totalSpend", "pendingCount"],
 *         "charts": ["spendingTrend"],
 *         "transactions": "pending"
 *       }
 *     }] }
 *   },
 *   {
 *     "match": { "userMessage": "spend report on the canvas", "turnIndex": 1 },
 *     "response": { "content": "I put a spend report on the canvas." }
 *   }
 *
 * (memory-learning.fixtures.json uses `sequenceIndex`; render-a2ui fixtures under
 * showcase/aimock use `turnIndex` + `hasToolResult`. Both are accepted by
 * loadFixtureFile — confirm the matching key on first run.)
 *
 * ── WHY test.fixme (headless CI honesty) ─────────────────────────────────────────
 * This gate needs the aimock stack running with the fixture above loaded
 * (Playwright webServer[0] currently loads only the memory fixtures) plus the
 * banking dev server. The fixture wiring and a first green run have not been
 * confirmed here, so — per the plan, where the aimock E2E is optional and MUST
 * NOT block the feature — it is marked test.fixme so it never reds the suite.
 * Remove `.fixme` once e2e/aimock-server.mjs loads this fixture and it passes
 * locally. (The render_report path itself is verified manually against a live
 * LLM: the report prompt paints KPIs + charts on the canvas.)
 */

const REPORT_PROMPT =
  "Build a spend report on the canvas: show the spending trend.";

test.describe("A2UI report canvas", () => {
  test.fixme("a report prompt renders the A2UI surface on the canvas with a handoff pill", async ({
    page,
  }) => {
    await page.goto("/");

    // The dashboard body (credit-cards page) is visible before any surface is
    // active — this is the "before" state we assert disappears.
    await expect(
      page.getByRole("heading", { name: "Credit Cards", level: 1 }),
    ).toBeVisible();

    // Open the docked chat (starts closed; v2 launcher has this testid).
    await page.getByTestId("copilot-chat-toggle").click();

    // Send a report prompt. "spend report on the canvas" is the aimock match key.
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill(REPORT_PROMPT);
    await input.press("Enter");

    // The chat shows the handoff pill (status-only a2ui-surface renderer in
    // wrapper.tsx).
    await expect(page.getByText(/rendered on the canvas/i)).toBeVisible({
      timeout: 30_000,
    });

    // The surface renders on the full-screen canvas (report-canvas.tsx).
    await expect(page.getByTestId("a2ui-surface")).toBeVisible({
      timeout: 30_000,
    });

    // While the surface is active the normal dashboard body is swapped out for
    // <ReportCanvas/> (layout.tsx: activeSurfaceId ? <ReportCanvas/> : children).
    await expect(
      page.getByRole("heading", { name: "Credit Cards", level: 1 }),
    ).toHaveCount(0);
  });
});
