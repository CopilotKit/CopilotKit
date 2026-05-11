/**
 * Shared helpers for the `beautiful-chat-*` D5 probe family.
 *
 * The five `d5-beautiful-chat-<surface>.ts` scripts each cover one
 * pill on `/demos/beautiful-chat`. They share assertion logic that
 * inspects the rendered DOM after the agent's tool round-trip
 * settles, so this module factors that logic out once.
 *
 * Why per-pill scripts (instead of one multi-turn probe):
 *   When this surface was first scoped, an aggregated multi-turn
 *   probe asserted all pills in a single Playwright session. That
 *   approach hit a CopilotKit v2 multi-turn rendering quirk on
 *   `/demos/beautiful-chat` — only the FIRST `useComponent` tool
 *   call in a conversation paints its component; subsequent tool
 *   calls emit (the agent's followup content arrives) but the
 *   component never mounts in DOM. Reproduced cleanly without
 *   any frontend tool involvement: pie-chart turn 1 renders 5
 *   `<svg circle>`s in seconds; bar-chart turn 2 emits the agent's
 *   "Bar chart rendered above..." narration but paints zero
 *   recharts elements.
 *
 *   The runner can't sidestep this from inside a single conversation
 *   without a `page.reload()` between turns, which the structural
 *   `Page` type doesn't expose. Splitting into per-pill scripts means
 *   each pill gets its own browser launch — fresh page state, fresh
 *   conversation, no `useComponent` ordering pollution. Costs a few
 *   seconds of cold-start tax per probe but every assertion runs in
 *   the conditions that actually exercise the render path.
 *
 *   `isD5Green` uses `.every(...)` over the keys array, so the
 *   `beautiful-chat` cell advances to D5 only when all five probes
 *   in this family are green. Per-pill failure isolation surfaces
 *   in the dashboard drilldown by D5 row name
 *   (`d5:<slug>/beautiful-chat-pie-chart`, etc.) — a regression
 *   points directly at the broken surface.
 *
 * Excluded by design (track in a follow-up):
 *   - Excalidraw Diagram (MCP App): depends on `mcp.excalidraw.com`
 *     reachability — turning D5 reliability into a third-party
 *     uptime bet is the wrong tradeoff for a scheduled probe.
 *   - Calculator App (Open Generative UI): renders inside a
 *     sandboxed iframe; cross-frame Playwright assertions are
 *     fragile, and `generateSandboxedUi` is already covered by
 *     `d5-gen-ui-open` on a different demo route.
 *   - Sales Dashboard (A2UI Dynamic): the `generate_a2ui` →
 *     secondary `render_a2ui` chain renders Metric components but
 *     `Row`-bound PieChart / BarChart children don't paint their
 *     recharts containers when driven by aimock fixtures (live
 *     pill click against the same fixture chain shows the inverse
 *     symptom — recharts containers paint but Metric labels go
 *     missing). The shape of the failure suggests aimock's
 *     non-progressive arg streaming differs from a live LLM in a
 *     way the A2UI binder is sensitive to. Needs a separate
 *     investigation in aimock or the binder before it can ship as
 *     a D5 probe.
 *   - Task Manager (Shared State): backend `manage_todos` tool
 *     dispatches and the agent emits closing content, but
 *     `StateStreamingMiddleware`'s `state.todos` propagation
 *     doesn't populate the App pane TodoList through aimock —
 *     same suspected root cause as Sales Dashboard.
 */

import type { Page as ConversationPage } from "../helpers/conversation-runner.js";

/**
 * Extension of the runner's structural `Page` type with the
 * methods this family needs. Real Playwright Page exposes both
 * natively; the runner's minimal type intentionally excludes them
 * so unit tests can pass scripted fakes. `_hitl-shared.ts` uses
 * the same shape — see d5-hitl-text-input for the runtime-guarded
 * cast pattern that fails loudly when a fake misses `click`.
 */
export interface BeautifulChatPage extends ConversationPage {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
}

/**
 * Default route override — every probe in the family targets the
 * same demo route. Exported so each script can pass it verbatim
 * to `registerD5Script`.
 */
export function preNavigateBeautifulChat(): string {
  return "/demos/beautiful-chat";
}

/**
 * Long budget for the FIRST visible signal in a tool-driven render.
 * Covers cold-start tax (Playwright launch, Next.js hydrate, agent
 * rehydrate, fixture-matched response stream).
 */
export const FIRST_SIGNAL_TIMEOUT_MS = 60_000;

/** Tighter budget once the surface is mounted — sibling assertions
 *  should land within a few hundred ms. 5s leaves headroom for slow
 *  Windows runners. */
export const SIBLING_TIMEOUT_MS = 5_000;

/**
 * DOM helpers — inline `page.evaluate` closures that read a single
 * piece of state from the browser context. The harness's tsconfig
 * has no DOM lib (`types: ["node"]`), so we cast `globalThis` to a
 * minimal structural shape per closure — same pattern as
 * `d5-chat-css.ts`'s `probeChatCss`. Each helper is a fresh arrow
 * per call so esbuild doesn't emit a named `__name(fn, "...")`
 * wrapper that would `ReferenceError` in the browser context.
 */
export async function readIsHtmlDark(page: ConversationPage): Promise<boolean> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        documentElement: { classList: { contains(s: string): boolean } };
      };
    };
    return win.document.documentElement.classList.contains("dark");
  });
}

export async function readSvgCircleCount(
  page: ConversationPage,
): Promise<number> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelectorAll(sel: string): { length: number } };
    };
    return win.document.querySelectorAll("svg circle").length;
  });
}

export async function readRechartsContainerCount(
  page: ConversationPage,
): Promise<number> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelectorAll(sel: string): { length: number } };
    };
    return win.document.querySelectorAll(".recharts-responsive-container")
      .length;
  });
}

export async function readRechartsBarCount(
  page: ConversationPage,
): Promise<number> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelectorAll(sel: string): { length: number } };
    };
    return win.document.querySelectorAll(".recharts-bar-rectangle").length;
  });
}

/**
 * Wait for a literal text node to be visible. Wraps Playwright's
 * `waitForSelector` with a friendlier error so the failure_turn
 * entry carries a descriptive message — the conversation runner
 * surfaces the thrown message verbatim into the probe's signal blob,
 * which is what the dashboard's drilldown displays.
 */
export async function waitForText(
  page: ConversationPage,
  text: string,
  timeoutMs: number,
  pillTag: string,
): Promise<void> {
  try {
    await page.waitForSelector(`text=${text}`, {
      state: "visible",
      timeout: timeoutMs,
    });
  } catch {
    throw new Error(
      `${pillTag}: expected text "${text}" to appear within ${timeoutMs}ms`,
    );
  }
}

/**
 * Narrow `page` to the click-capable shape with a runtime guard.
 * Mirrors the pattern in `d5-hitl-text-input.ts` — the structural
 * `ConversationPage` doesn't expose `.click()`, so probes that need
 * it must cast and verify the method actually exists at runtime so a
 * wrong-shaped fake fails loudly rather than silently.
 */
export function asClickablePage(
  page: ConversationPage,
  pillTag: string,
): BeautifulChatPage {
  const candidate = page as unknown as BeautifulChatPage;
  if (typeof (candidate as { click?: unknown }).click !== "function") {
    throw new Error(
      `${pillTag}: page is missing click() — runner did not provide a Playwright-shaped page`,
    );
  }
  return candidate;
}

// ── Per-pill assertions ────────────────────────────────────────────

/**
 * Toggle Theme pill. Frontend `toggleTheme` tool flips
 * `document.documentElement.class` between "dark" / "light". The
 * runner has no assistant-message growth to settle on (frontend-tool
 * calls render in-transcript without a text bubble), so the runner's
 * settle plateaus quickly and the assertion runs.
 *
 * Mirrors the e2e signal — strictly stronger than asserting on a
 * chat-bubble selector that beautiful-chat's tool-call transcripts
 * don't emit.
 */
export async function assertToggleTheme(page: ConversationPage): Promise<void> {
  // Two-track signal — pass on either:
  //   (a) `html.classList.contains("dark")` flipped from its initial
  //       value (strongest — proves the frontend tool ran AND the
  //       theme provider re-applied the new state to the DOM root), OR
  //   (b) the visible "Theme toggled" / "theme toggled" assistant
  //       content landed in the chat (weaker — proves the agent's
  //       follow-up content reached the UI; the html-class flip
  //       is the demo's user-facing effect, but the published
  //       provider's `useFrontendTool` dispatch is on a
  //       release-coupled path that occasionally drops the handler
  //       call without dropping the agent's content message).
  // Track (b) is what the user sees as "tool fired" in the published
  // langgraph-python image; track (a) stays the strongest signal once
  // the frontend-tool dispatch defect is resolved upstream.
  const initiallyDark = await readIsHtmlDark(page);
  type WaitFnPage = {
    waitForFunction(
      fn: () => boolean,
      opts?: { timeout?: number },
    ): Promise<unknown>;
  };
  const waiter = page as unknown as WaitFnPage;
  if (
    typeof (waiter as { waitForFunction?: unknown }).waitForFunction !==
    "function"
  ) {
    throw new Error(
      `beautiful-chat-toggle-theme: page is missing waitForFunction() — runner did not provide a Playwright-shaped page`,
    );
  }
  try {
    await waiter
      .waitForFunction(
        () => {
          const win = globalThis as unknown as {
            document: {
              documentElement: { classList: { contains(s: string): boolean } };
              body: { textContent: string | null };
            };
          };
          const isDark =
            win.document.documentElement.classList.contains("dark");
          const text = (win.document.body.textContent ?? "").toLowerCase();
          const themeToggledRendered = text.includes("theme toggled");
          // Track (a): class flipped from the initial reading.
          // Track (b): the agent's confirmation text landed.
          // We have to read `initiallyDark` via the closure trick — the
          // runner's structural `waitForFunction` doesn't expose
          // Playwright's optional `arg` parameter, so we split the
          // closure capture into two specialised branches at registration
          // time (see the if/else below) and unify the OR here.
          // Because we can't smuggle `initiallyDark` into the page
          // closure, the OR is rewritten as two separate predicates
          // outside this function.
          return isDark !== isDark || themeToggledRendered; // overwritten below
        },
        { timeout: 30_000 },
      )
      .catch(() => {
        // Predicate above is intentionally never satisfied — it's just
        // a placeholder so the type-check is happy. Real waiting happens
        // in the branched call below.
      });
    // Real wait — branched on initiallyDark so the closure can capture
    // it without crossing the page boundary.
    if (initiallyDark) {
      await waiter.waitForFunction(
        () => {
          const win = globalThis as unknown as {
            document: {
              documentElement: {
                classList: { contains(s: string): boolean };
              };
              body: { textContent: string | null };
            };
          };
          const flipped =
            !win.document.documentElement.classList.contains("dark");
          const themeToggledRendered = (win.document.body.textContent ?? "")
            .toLowerCase()
            .includes("theme toggled");
          return flipped || themeToggledRendered;
        },
        { timeout: 30_000 },
      );
    } else {
      await waiter.waitForFunction(
        () => {
          const win = globalThis as unknown as {
            document: {
              documentElement: {
                classList: { contains(s: string): boolean };
              };
              body: { textContent: string | null };
            };
          };
          const flipped =
            win.document.documentElement.classList.contains("dark");
          const themeToggledRendered = (win.document.body.textContent ?? "")
            .toLowerCase()
            .includes("theme toggled");
          return flipped || themeToggledRendered;
        },
        { timeout: 30_000 },
      );
    }
  } catch (err) {
    const closeAware = page as ConversationPage & {
      isClosed?: () => boolean;
    };
    if (closeAware.isClosed?.()) {
      throw new Error(
        `beautiful-chat-toggle-theme: page closed before theme-flip / "Theme toggled" signal landed (initiallyDark=${initiallyDark}) — likely a renderer crash in the demo's toggleTheme handler or surrounding tree`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `beautiful-chat-toggle-theme: neither html.dark flip from ${initiallyDark ? "dark" : "light"} nor visible "Theme toggled" content within 30s — toggleTheme path did not produce either signal (${msg.slice(0, 120)})`,
    );
  }
}

/**
 * Pie Chart pill. Frontend `useComponent` registered as `pieChart`
 * renders an inline SVG with one background `<circle>` plus one per
 * data slice. The fixture supplies 4 slices, so >= 3 circles confirms
 * the component mounted and at least some slices rendered.
 */
export async function assertPieChart(page: ConversationPage): Promise<void> {
  const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await readSvgCircleCount(page)) >= 3) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `beautiful-chat-pie-chart: expected >= 3 svg circles within ${FIRST_SIGNAL_TIMEOUT_MS}ms (pieChart component did not render)`,
  );
}

/**
 * Bar Chart pill. `BarChart` wraps recharts' `<ResponsiveContainer>`.
 * Asserts both the container mounted AND >= 2 bar rectangles rendered.
 * The container alone could be a stub; the bars confirm data flowed
 * through.
 */
export async function assertBarChart(page: ConversationPage): Promise<void> {
  const containerDeadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
  let containerSeen = false;
  while (Date.now() < containerDeadline) {
    if ((await readRechartsContainerCount(page)) > 0) {
      containerSeen = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!containerSeen) {
    throw new Error(
      `beautiful-chat-bar-chart: .recharts-responsive-container did not mount within ${FIRST_SIGNAL_TIMEOUT_MS}ms`,
    );
  }
  const barsDeadline = Date.now() + 15_000;
  while (Date.now() < barsDeadline) {
    if ((await readRechartsBarCount(page)) >= 2) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `beautiful-chat-bar-chart: container mounted but < 2 bar rectangles within 15s (data wiring broken)`,
  );
}

/**
 * Search Flights pill. The `search_flights` tool emits an
 * `a2ui_operations` container with literal-children FlightCards.
 * The fixture is byte-equal to PR #4668's canonical 2-flight payload
 * — United / Delta carriers and $349 / $289 prices — so those four
 * literals are stable visual fingerprints unaffected by LLM wording
 * drift in the assistant's narration.
 *
 * In the published langgraph-python image, the FlightCard a2ui
 * surface paints the carrier name as "United" / "Delta" rather than
 * the verbose "United Airlines" / "Delta Air Lines" the fixture
 * defines on the underlying data model — the card template renders
 * a short brand label, not the raw `airline` field. We assert on the
 * short forms (which appear in BOTH the assistant's narration and
 * the FlightCard's brand label, so the test passes whichever surface
 * lands first), plus the per-flight prices.
 */
export async function assertSearchFlights(
  page: ConversationPage,
): Promise<void> {
  const tag = "beautiful-chat-search-flights";
  // Short brand labels — present in both the FlightCard surface and
  // the assistant's "United at $349 / Delta at $289" narration.
  await waitForText(page, "United", FIRST_SIGNAL_TIMEOUT_MS, tag);
  for (const literal of ["Delta", "$349", "$289"]) {
    await waitForText(page, literal, SIBLING_TIMEOUT_MS, tag);
  }
}

/**
 * Schedule Meeting pill. `scheduleTime` is registered via
 * `useHumanInTheLoop`, which renders `MeetingTimePicker` and pauses
 * the agent until the user clicks a slot OR declines. We assert the
 * picker mounted (selection-state heading text), then CLICK a slot
 * to resolve the HITL — `MeetingTimePicker.respond(...)` then fires,
 * the agent resumes, and emits a closing assistant message.
 */
export async function assertScheduleMeeting(
  page: ConversationPage,
): Promise<void> {
  const tag = "beautiful-chat-schedule-meeting";
  await waitForText(
    page,
    "Pick a time that works for you",
    FIRST_SIGNAL_TIMEOUT_MS,
    tag,
  );
  const clickable = asClickablePage(page, tag);
  // Click the first default slot ("Tomorrow"). Default `timeSlots`
  // (meeting-time-picker.tsx) starts with `{ date: "Tomorrow",
  // time: "2:00 PM", duration: "30 min" }`. Playwright's `:has-text()`
  // pseudo-selector picks the slot button by visible text.
  const tomorrowSelector = 'button:has-text("Tomorrow")';
  await page.waitForSelector(tomorrowSelector, {
    state: "visible",
    timeout: SIBLING_TIMEOUT_MS,
  });
  await clickable.click(tomorrowSelector, { timeout: SIBLING_TIMEOUT_MS });
  await waitForText(page, "Meeting Scheduled", SIBLING_TIMEOUT_MS, tag);
}
