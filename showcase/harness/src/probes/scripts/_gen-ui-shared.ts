/**
 * D5 — gen-UI shared helpers.
 *
 * Used by `d5-gen-ui-custom.ts` (frontend-defined `render_pie_chart`).
 * The headless tier no longer shares these helpers — `headless-simple`
 * was downsized to text-only post-refactor; `headless-complete` has
 * its own probe that asserts on its specific tool cards.
 *
 * The remaining caller:
 *   1. Wait for a custom-rendered component to appear in the DOM (NOT
 *      just the assistant's text bubble — gen-UI's whole point is that
 *      the tool call materialises into bespoke React).
 *   2. Run a structural check: the component must be non-trivial (have
 *      children / not be an empty wrapper). The custom variant goes
 *      further and asserts the exact shape (e.g. an SVG donut chart for
 *      `render_pie_chart`).
 *
 * Why a leading-underscore filename? The D5 driver's script loader
 * (`drivers/e2e-deep.ts → defaultScriptLoader`) matches files against
 * `^d5-.*\.(js|ts)$`. Files prefixed with `_` (or any non-`d5-` prefix)
 * are skipped, so this helper file co-exists in `scripts/` without the
 * loader trying to import it as a script.
 *
 * The DOM-walker functions run inside `page.evaluate(...)` callbacks —
 * they execute in the browser context, not in Node. They take no
 * dependency on the DOM lib at the type level (the runner module
 * intentionally excludes `dom` for server-side compile-cleanliness),
 * which is why the browser-side code uses a small typed indirection
 * through `globalThis`. Same pattern as `conversation-runner.ts`.
 */

import {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
  type Page,
} from "../helpers/conversation-runner.js";

/**
 * Selector cascade used to find a rendered gen-UI component in the
 * showcase's DOM. The order is load-bearing:
 *
 *   1-2. CopilotKit canonical testids — the strictest signal. Showcases
 *        that have wired `data-testid` on their custom components match
 *        here first.
 *   3.   `[data-tool-name="..."]` — secondary explicit affordance some
 *        showcases attach to the wrapper around `useComponent` output.
 *   4.   `.copilotkit-render-component` — class hook some custom-composer
 *        renderers attach when calling `useRenderToolCall`.
 *   5-7. Canonical V2 assistant-message scoped fallbacks. The V2 chat
 *        wraps each assistant bubble in
 *        `[data-testid="copilot-assistant-message"]`, and gen-UI
 *        components materialise INSIDE that bubble (e.g. an SVG chart,
 *        or a testid-tagged custom component). Try SVG first (chart
 *        shape), then any nested testid, then the bubble itself.
 *   8-9. Generic structural fallbacks — `[role="article"]` is what
 *        older chat-message renderers wrap each assistant message in;
 *        an SVG anywhere on the page indicates a chart-style component
 *        materialised. Both are last-resort and intentionally broad.
 *
 * Kept as a const tuple so the order is preserved across iteration.
 */
export const GEN_UI_COMPONENT_SELECTORS = [
  '[data-testid="gen-ui-card"]',
  '[data-testid="gen-ui-component"]',
  "[data-tool-name]",
  ".copilotkit-render-component",
  '[data-testid="copilot-assistant-message"] svg',
  '[data-testid="copilot-assistant-message"] [data-testid]',
  '[data-testid="copilot-assistant-message"]',
  '[data-message-role="assistant"] svg',
  '[data-message-role="assistant"] [data-testid]',
  '[data-message-role="assistant"]',
  '[role="article"] svg',
  '[role="article"]',
] as const;

const DEFAULT_RENDER_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 200;

/**
 * Block until at least one selector in the cascade resolves to a node
 * AND that node has non-trivial structure (childElementCount > 0). Throws
 * a descriptive Error on timeout so the conversation-runner records it
 * as the turn's failure message.
 *
 * Returns the matching selector so callers can run further structural
 * checks against the same node without re-resolving the cascade.
 */
export async function waitForGenUiComponent(
  page: Page,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    const matched = await findFirstNonTrivial(page);
    if (matched.selector) return matched.selector;
    lastError = matched.reason;
    await sleep(POLL_INTERVAL_MS);
  }

  // Build the DOM-snapshot probe as a string-based function to avoid
  // esbuild's keepNames transform injecting `__name()` wrappers inside
  // the browser context (where `__name` is not defined).
  const domSnapshotCode = `
    (() => {
      var doc = globalThis.document;
      function probe(label, sel) {
        var nodes = doc.querySelectorAll(sel);
        if (nodes.length === 0) return label + ": no elements found";
        var summary = [];
        for (var i = 0; i < Math.min(nodes.length, 5); i++) {
          var el = nodes[i];
          summary.push(
            "<" + el.tagName.toLowerCase() + " class=\\"" + el.className + "\\" children=" + el.childElementCount + ">" +
            (el.textContent || "").slice(0, 80)
          );
        }
        return label + ": " + summary.join(" | ");
      }
      return [
        probe("[role=article]", '[role="article"]'),
        probe("[data-message-role=assistant]", '[data-message-role="assistant"]')
      ].join(" || ");
    })()
  `;
  const domSnapshotFn = new Function(
    `return ${domSnapshotCode.trim()};`,
  ) as () => string;
  const domSnapshot = await page.evaluate(domSnapshotFn);
  throw new Error(
    `gen-ui component did not render within ${timeoutMs}ms (${
      lastError ?? "no candidate selector matched"
    }; DOM: ${domSnapshot})`,
  );
}

/**
 * Run the cascade once. Returns the first selector whose node has
 * children, OR `{ reason }` describing why nothing qualified yet so the
 * timeout error message is actionable. Empty wrappers (e.g. an
 * unstyled `<div>` with zero children) explicitly do NOT count — the
 * whole point of gen-UI is that something rendered.
 */
async function findFirstNonTrivial(
  page: Page,
): Promise<{ selector?: string; reason?: string }> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<{
          childElementCount: number;
          tagName: string;
        }>;
      };
    };
    // The selector list is duplicated here (NOT imported) because this
    // function executes inside the browser via page.evaluate — it
    // doesn't have access to the Node module graph. Keep in sync with
    // GEN_UI_COMPONENT_SELECTORS above.
    const selectors = [
      '[data-testid="gen-ui-card"]',
      '[data-testid="gen-ui-component"]',
      "[data-tool-name]",
      ".copilotkit-render-component",
      '[data-testid="copilot-assistant-message"] svg',
      '[data-testid="copilot-assistant-message"] [data-testid]',
      '[data-testid="copilot-assistant-message"]',
      '[data-message-role="assistant"] svg',
      '[data-message-role="assistant"] [data-testid]',
      '[data-message-role="assistant"]',
      '[role="article"] svg',
      '[role="article"]',
    ];
    let lastReason = "no selector matched";
    for (const selector of selectors) {
      // Use querySelectorAll and check ALL matches — querySelector
      // only returns the first match, and if that first match is an
      // empty wrapper (children=0) the cascade would skip the selector
      // entirely even when a later match has content. This happens in
      // headless chat pages where the first assistant message div is
      // empty but a subsequent one contains the rendered component.
      const nodes = win.document.querySelectorAll(selector);
      if (nodes.length === 0) {
        lastReason = `no match for ${selector}`;
        continue;
      }
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (
          node.childElementCount === 0 &&
          node.tagName.toLowerCase() !== "svg"
        ) {
          lastReason = `${selector} matched but is an empty wrapper`;
          continue;
        }
        return { selector };
      }
    }
    return { reason: lastReason };
  });
}

/**
 * Structural shape descriptor for an SVG-based chart (e.g. the
 * `render_pie_chart` donut chart in
 * `gen-ui-tool-based/pie-chart.tsx`). The pie-chart implementation we
 * ship today renders one `<circle>` per data slice plus a single
 * background `<circle>`, all inside a single `<svg>`. The structural
 * assertion uses these counts to distinguish "chart rendered" from
 * "empty SVG placeholder" or "wrong component rendered".
 */
export interface SvgChartShape {
  /** True iff the page contains at least one `<svg>` element. */
  hasSvg: boolean;
  /** Total number of `<circle>` elements anywhere inside the SVG. */
  circleCount: number;
  /** Total number of `<path>` elements anywhere inside the SVG. */
  pathCount: number;
  /**
   * Total number of `<rect>` elements anywhere inside the SVG. Bar
   * charts use rects; carried here so the assertion can branch on
   * "circle-or-rect" without needing two probe shapes.
   */
  rectCount: number;
  /** Combined drawing-element count: circles + paths + rects. */
  drawingChildren: number;
}

/**
 * Read the structural shape of the first `<svg>` on the page. Returns
 * `{ hasSvg: false, ... 0 }` when no SVG is present so callers don't
 * need to null-check.
 */
export async function readSvgChartShape(page: Page): Promise<SvgChartShape> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
        querySelectorAll(sel: string): { length: number };
      };
    };
    const svg = win.document.querySelector("svg");
    if (!svg) {
      return {
        hasSvg: false,
        circleCount: 0,
        pathCount: 0,
        rectCount: 0,
        drawingChildren: 0,
      };
    }
    // Count any matching descendants anywhere in the document — gen-UI
    // showcases render the chart inline in the chat message bubble, so
    // the SVG is in-document and there's only one chart at a time on
    // the page in practice. Multiple SVGs would inflate the counts but
    // the structural assertion only asserts a lower bound, so a stray
    // logo SVG can't make the assertion spuriously pass.
    const circles = win.document.querySelectorAll("svg circle");
    const paths = win.document.querySelectorAll("svg path");
    const rects = win.document.querySelectorAll("svg rect");
    return {
      hasSvg: true,
      circleCount: circles.length,
      pathCount: paths.length,
      rectCount: rects.length,
      drawingChildren: circles.length + paths.length + rects.length,
    };
  });
}

/**
 * Look up the assistant's most recent textual content — used by the
 * headless assertion to confirm the model acknowledged the rendered
 * component (per the recorded fixture, the second-leg response is a
 * short narration of what was shown). Returns the empty string when
 * no assistant text is present.
 *
 * IMPORTANT: The canonical CopilotKit assistant message DOM is:
 *
 *   <div data-testid="copilot-assistant-message">
 *     <div class="cpk:prose ...">   ← text content (markdown)
 *     tool-call renders             ← rendered components (SVG charts, cards, etc.)
 *     toolbar                       ← copy/thumbs/read-aloud buttons
 *   </div>
 *
 * Reading `textContent` on the outer wrapper picks up EVERYTHING —
 * including rendered tool-component labels (e.g. pie-chart SVG text
 * like "Electronics42,000" or "Clothing28,000"). This function
 * targets ONLY the prose div (first child) to extract the actual
 * assistant text message, not rendered component output.
 *
 * For non-canonical selectors (role="article", data-message-role)
 * the prose-scoping is attempted but falls back to the full element
 * when the expected DOM structure isn't present.
 */
export async function readLastAssistantText(page: Page): Promise<string> {
  const code = `
    (() => {
      const doc = globalThis.document;
      const canonical = doc.querySelectorAll(${JSON.stringify(
        ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
      )});
      let list = canonical.length > 0
        ? canonical
        : doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
      if (list.length === 0) {
        list = doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
        )});
      }
      if (list.length === 0) return "";
      const last = list[list.length - 1];
      if (!last) return "";

      // Scope to the prose/markdown child to exclude rendered tool
      // components (charts, cards) and toolbar buttons. The prose div
      // is always the first child of the canonical assistant-message
      // wrapper and carries a class containing "prose".
      var proseChild = last.querySelector && last.querySelector('[class*="prose"]');
      if (!proseChild) {
        // Fallback: first child div (the prose wrapper is always the
        // first <div> child in the canonical layout).
        var firstDiv = last.querySelector && last.querySelector(':scope > div:first-child');
        if (firstDiv) {
          // Only use this if the assistant message has more than one
          // child (i.e. there's a tool-call render or toolbar sibling).
          // If there's only one child, the whole element IS the text.
          if (last.childElementCount > 1) {
            proseChild = firstDiv;
          }
        }
      }

      var target = proseChild || last;
      var text = (target.textContent || "").trim();

      // Debug: log what we're reading so production traces show exactly
      // which element was selected and what text was extracted.
      if (typeof console !== "undefined" && console.log) {
        console.log(
          "[readLastAssistantText] selector=" +
          (canonical.length > 0 ? ${JSON.stringify(ASSISTANT_MESSAGE_PRIMARY_SELECTOR)} : "fallback") +
          " scoped=" + (proseChild ? "prose" : "full") +
          " text=" + JSON.stringify(text.slice(0, 120))
        );
      }

      return text;
    })()
  `;
  const fn = new Function(`return ${code.trim()};`) as () => string;
  return await page.evaluate(fn);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
