import { test, expect } from "@playwright/test";

/**
 * A2UI report canvas E2E (Task 11).
 *
 * Proves the render_a2ui → mirror-pill → full-screen canvas handoff:
 * an assistant turn calls the runtime-injected `render_a2ui` tool with a MINIMAL
 * banking surface (a Heading + one spendingTrend Chart); the runtime's
 * A2UIMiddleware synthesizes an `a2ui-surface` activity, the chat mirror renderer
 * (src/a2ui/mirror-renderer.tsx) drops a "rendered on the canvas" pill and pushes
 * the surface onto the full-screen canvas (channel "default"), and LayoutComponent
 * swaps the dashboard body out for <ReportCanvas/> (data-testid="a2ui-surface").
 *
 * ── HOW render_a2ui BECOMES AN a2ui-surface ACTIVITY (verified) ──────────────────
 * The runtime enables `a2ui: { injectA2UITool: true }` on BOTH runtime variants
 * (src/app/api/copilotkit/[[...slug]]/route.ts) and the provider forwards the
 * banking catalog (wrapper.tsx: a2ui={{ catalog, includeSchema: true }}). The
 * injected tool is named `render_a2ui` and takes STRUCTURED args
 * { surfaceId, components[], data? } — the flat A2UI v0.9 component array whose
 * root has id "root". The AG-UI A2UIMiddleware intercepts the tool call and
 * SYNTHESIZES the a2ui-surface ACTIVITY_SNAPSHOT (content.a2ui_operations =
 * createSurface + updateComponents [+ updateDataModel]); the client renderer
 * consumes only that activity, never the raw tool call. So the aimock fixture
 * only needs to emit a `render_a2ui` toolCall with the structured args below —
 * it must NOT pre-bake a2ui_operations. Chart binds its own data on the client,
 * so pass NO numbers (banking catalog: src/a2ui/catalog/definitions.ts).
 *
 * ── REQUIRED aimock FIXTURE (not yet wired — see test.fixme below) ───────────────
 * This turn-based fixture drives the run deterministically. It must be loaded by
 * the aimock server (e2e/aimock-server.mjs) alongside the memory fixtures. The
 * server currently hardcodes only fixtures/memory-learning.fixtures.json, so
 * wiring this file (or appending these entries) is the remaining step:
 *
 *   {
 *     "match": { "userMessage": "spend report on the canvas", "turnIndex": 0 },
 *     "response": { "toolCalls": [{
 *       "name": "render_a2ui",
 *       "arguments": {
 *         "surfaceId": "banking-report",
 *         "components": [
 *           { "id": "root", "component": "Stack", "gap": "lg",
 *             "children": ["title", "trend"] },
 *           { "id": "title", "component": "Heading",
 *             "text": "Spend report" },
 *           { "id": "trend", "component": "Chart", "kind": "spendingTrend" }
 *         ]
 *       }
 *     }] }
 *   },
 *   {
 *     "match": { "userMessage": "spend report on the canvas", "turnIndex": 1 },
 *     "response": { "content": "I put a spend report on the canvas." }
 *   }
 *
 * (The `memory-learning.fixtures.json` in this dir uses `sequenceIndex`; the D6
 * render-a2ui fixtures under showcase/aimock use `turnIndex` + `hasToolResult`.
 * Both are accepted by loadFixtureFile — confirm the matching key on first run.)
 *
 * ── WHY test.fixme (headless CI honesty) ─────────────────────────────────────────
 * This gate needs the aimock stack running with the a2ui fixture above loaded
 * (Playwright webServer[0] currently loads only the memory fixtures) plus the
 * banking dev server. Neither the fixture wiring nor a first green run has been
 * confirmed, so per Task 11 the aimock E2E is optional and MUST NOT block the
 * feature: it is marked test.fixme so it never reds the suite. Remove `.fixme`
 * once e2e/aimock-server.mjs loads the a2ui fixture and this passes locally.
 */

const REPORT_PROMPT =
  "Build a spend report on the canvas: show the spending trend.";

test.describe("A2UI report canvas (Task 11)", () => {
  test.fixme(
    "a report prompt renders the A2UI surface on the canvas with a handoff pill",
    async ({ page }) => {
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

      // The chat mirror renderer leaves the handoff pill (mirror-renderer.tsx).
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
    },
  );
});
