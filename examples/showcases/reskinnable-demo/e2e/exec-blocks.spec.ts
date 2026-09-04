import { test, expect } from "@playwright/test";

/**
 * Exec (Vantage) skin — beat 1 headline path E2E.
 *
 * Proves the render_metric_block → inline block → pin → persists handoff: the
 * beat-1 suggestion pill ("Show revenue vs. plan this quarter",
 * `src/skins/exec/suggestions.ts`) asks the agent to show revenue vs. plan; the
 * backend `render_metric_block` tool (src/skins/exec/agent.ts) builds a draft
 * block and returns `{ a2ui_operations: [...] }` (deterministically, via
 * `../blocks/build-block-ops.ts` — the model only emits a small selection, it
 * never authors component JSON or numbers). Because the block's surface id is
 * `block:`-prefixed, `src/app/[skin]/layout.tsx`'s `A2UISurfaceActivity`
 * recognizes it (via the shell's `blockSurfaceIdFrom`, deliberately duplicated
 * from the skin's own `BLOCK_SURFACE_PREFIX`) and renders it INLINE in the
 * transcript as `<InlineBlockSurface/>` (data-testid="inline-block-surface") —
 * unlike the banking/report and OGUI surfaces, which collapse to a small
 * handoff pill and hand off to the full-screen canvas instead. The block ships
 * with an "Add to dashboard" control (`AddToDashboard`,
 * `src/skins/exec/catalog/renderers.tsx`) with one button per dashboard;
 * clicking "Pin to CEO dashboard" calls `useBlockData().addBlock("ceo", ...)`,
 * which POSTs to `/api/exec/v1/dashboards/ceo/blocks` — a SERVER-SIDE write,
 * not just local component state. The CEO dashboard page (`../pages/ceo-
 * dashboard.tsx`, the exec skin's index, segment "") renders every pinned
 * block through `DashboardGrid` (`../components/dashboard-grid.tsx`), which
 * reads `useExecLedger().snapshot.dashboards.ceo.blocks` — so a pin should
 * still be there after a full page reload, because it lives on the server,
 * not in a component that reload would tear down.
 *
 * ── WHY THE TEST STARTS ON THE METRICS PAGE, NOT THE CEO DASHBOARD ───────────
 * The CEO dashboard IS the exec index (`/exec`), so sending the pill there and
 * then asserting the pinned card is also there would never actually exercise a
 * navigation — the dashboard grid would just already be sitting behind the
 * chat the whole time. Starting on `/exec/metrics` (the metrics explorer, a
 * different page under the same skin) and then clicking the sidebar's own "CEO
 * dashboard" nav link makes the "navigate to the CEO dashboard" step a real
 * client-side route change — the suggestion pills are registered
 * `available: "always"` at the shell layout level (`SkinSuggestions` in
 * `src/app/[skin]/layout.tsx`), so they render identically on every exec page,
 * and the docked chat (mounted once by that same shared layout) keeps its
 * thread across the route change.
 *
 * ── REQUIRED aimock FIXTURE (NOT YET WIRED — see test.fixme below) ───────────
 * aimock mocks ONLY the LLM; the real backend `execute` still runs and builds
 * the ops. It must be loaded by the aimock server (e2e/aimock-server.mjs),
 * which currently hardcodes only fixtures/memory-learning.fixtures.json (the
 * banking over-limit-charge fixtures) as its default file — there is no
 * exec / render_metric_block fixture anywhere in the repo (confirmed:
 * `grep -rl render_metric_block e2e/fixtures/` finds nothing). The pill's
 * message is `execSuggestions[0].message` in `src/skins/exec/suggestions.ts`:
 *
 *   "Show me revenue vs. plan for this quarter."
 *
 * A fixture set for it would look like:
 *
 *   {
 *     "match": { "userMessage": "Show me revenue vs. plan for this quarter.", "turnIndex": 0 },
 *     "response": { "toolCalls": [{
 *       "name": "render_metric_block",
 *       "arguments": {
 *         "kind": "trendLine",
 *         "title": "Revenue vs. plan",
 *         "metricId": "revenue",
 *         "department": "all"
 *       }
 *     }] }
 *   },
 *   {
 *     "match": { "userMessage": "Show me revenue vs. plan for this quarter.", "turnIndex": 1 },
 *     "response": { "content": "Revenue is tracking against plan this quarter — see the block above." }
 *   }
 *
 * (exact `renderMetricBlockParams` shape confirmed by reading `agent.ts`; the
 * `title`/metricId choice above is illustrative, not verified against a live
 * model.) No launcher change is needed to serve it: `e2e/aimock-server.mjs`
 * already reads `AIMOCK_FIXTURES` (an absolute path, or one relative to cwd) and
 * `AIMOCK_PORT`, defaulting to `fixtures/memory-learning.fixtures.json` on 7099.
 * One fixture file per server instance is the design, and the precedent for a
 * second one already ships: `playwright.ogui.config.ts:22-28` starts its own
 * aimock with `AIMOCK_FIXTURES=e2e/fixtures/ogui-routing.fixtures.json
 * AIMOCK_PORT=7098`. Enabling this spec is therefore a config task — add an exec
 * fixture file beside those two and a webServer entry (or project) that points
 * an instance at it on a free port.
 *
 * ── WHY THE DASHBOARD ASSERTIONS MATCH A HEADING, NOT TEXT ───────────────────
 * A pinned card renders its title TWICE inside the app panel: once as the card
 * chrome's uppercase `<span>` (`../src/skins/exec/components/dashboard-grid
 * .tsx`) and once as the block's own `<h2>` (the `Heading` catalog renderer,
 * from the ops). `getByText(blockTitle)` therefore resolves two nodes and
 * fails Playwright's strict mode — a latent trap that would only fire once the
 * fixture above exists. `getByRole("heading", { name })` is exact: the chrome
 * span carries no heading role.
 *
 * ── WHY test.fixme (headless CI honesty) ──────────────────────────────────────
 * Same call as `e2e/a2ui-canvas.spec.ts`: this gate needs the aimock fixture
 * above loaded and a first green run confirmed against it, which has not
 * happened here — there is no exec fixture file, and this worktree also has no
 * `.env` carrying a real `OPENAI_API_KEY` (only `.env.example`; the config's
 * `unlocked` webServer would fall back to a dummy key regardless, since it
 * points `OPENAI_BASE_URL` at aimock by default either way — the real blocker
 * is the missing fixture, not the key). Per the plan, an aimock-driven E2E is
 * optional and MUST NOT block the feature, so this is marked `test.fixme` so it
 * can never red the suite. Remove `.fixme` once a fixture set for
 * `render_metric_block` is added and this passes locally.
 */

const BEAT_1_PILL_TITLE = "Show revenue vs. plan this quarter";

test.describe("exec (Vantage) dashboard blocks", () => {
  test.fixme("the beat-1 pill renders an inline block that pins to the CEO dashboard and survives a reload", async ({
    page,
  }) => {
    // Start on a different exec page so the later "navigate to the CEO
    // dashboard" step is a real route change, not a no-op — see header.
    await page.goto("/exec/metrics");

    // Send the beat-1 pill. Suggestions are the shell's generic
    // `demo-suggestion-<index>` pills (shell/chat/demo-suggestions.tsx);
    // beat 1 is execSuggestions[0].
    const pill = page.getByTestId("demo-suggestion-0");
    await expect(pill).toHaveText(BEAT_1_PILL_TITLE);
    await pill.click();

    // The block renders INLINE in the transcript (not a canvas handoff
    // pill — the `block:`-prefixed surface id routes to InlineBlockSurface).
    // `.first()`: the agent is instructed to render one block per turn, but
    // nothing in the transcript ENFORCES that, and an unqualified locator
    // matching two cards is a strict-mode violation rather than a useful
    // failure. Assert against the first card and let a wrong count show up as
    // a content mismatch below.
    const inlineSurface = page.getByTestId("inline-block-surface").first();
    await expect(inlineSurface).toBeVisible({ timeout: 30_000 });

    // Capture the block's own title so the later dashboard-grid assertion
    // does not have to hardcode agent-authored text (the model, not this
    // test, picks the block's `title`). `.first()` for the same reason: a
    // catalog-composed block may carry more than one heading level, and the
    // outermost one is the title.
    const blockTitle = await inlineSurface
      .getByRole("heading")
      .first()
      .innerText();
    expect(blockTitle.length).toBeGreaterThan(0);

    // Pin it to the CEO dashboard. `AddToDashboard` also renders a "Pin to
    // CFO dashboard" button, so name the exact one.
    await inlineSurface
      .getByRole("button", { name: "Pin to CEO dashboard" })
      .click();

    // The whole control collapses to "Pinned ✓" on success (never a live
    // second button — see AddToDashboard's doc comment) — wait for it
    // before navigating away, so a failed pin fails HERE, not three steps
    // later as a missing dashboard card.
    await expect(inlineSurface.getByRole("status")).toHaveText("Pinned ✓");

    // Navigate to the CEO dashboard via the sidebar's own nav link — a real
    // client-side route change, not a re-render of the page we started on.
    await page.getByRole("link", { name: "CEO dashboard" }).click();
    await expect(page).toHaveURL(/\/exec$/);

    // The block card is on the page, in the app panel (not the chat
    // transcript, which still shows its own copy of the same title).
    const appPanel = page.getByTestId("app-panel");
    const blockHeading = appPanel.getByRole("heading", { name: blockTitle });
    await expect(blockHeading).toBeVisible();

    // Reload — proves the pin is a server-side write (the ledger API), not
    // component state a hard refresh would have torn down.
    await page.reload();
    await expect(blockHeading).toBeVisible();
  });
});
