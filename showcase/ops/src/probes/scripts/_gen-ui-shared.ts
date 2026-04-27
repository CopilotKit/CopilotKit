/**
 * D5 — gen-UI shared helpers.
 *
 * Shared between `d5-gen-ui-headless.ts` (frontend-defined `show_card`)
 * and `d5-gen-ui-custom.ts` (frontend-defined `render_pie_chart`). Both
 * scripts:
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
 *   5-6. Generic structural fallbacks — `[role="article"]` is what the
 *        chat-message renderer wraps each assistant message in; an SVG
 *        anywhere on the page indicates a chart-style component
 *        materialised. Both are last-resort and intentionally broad.
 *
 * Kept as a const tuple so the order is preserved across iteration.
 */
export const GEN_UI_COMPONENT_SELECTORS = [
  '[data-testid="gen-ui-card"]',
  '[data-testid="gen-ui-component"]',
  "[data-tool-name]",
  ".copilotkit-render-component",
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

  const domSnapshot = await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<{
          tagName: string;
          childElementCount: number;
          className: string;
          textContent: string | null;
        }>;
      };
    };
    const articles = win.document.querySelectorAll('[role="article"]');
    const summary: string[] = [];
    for (let i = 0; i < Math.min(articles.length, 5); i++) {
      const el = articles[i]!;
      summary.push(
        `<${el.tagName.toLowerCase()} class="${el.className}" children=${el.childElementCount}>` +
          `${(el.textContent ?? "").slice(0, 80)}`,
      );
    }
    return summary.length > 0
      ? summary.join(" | ")
      : "no [role=article] elements found";
  });
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
        querySelector(sel: string): {
          childElementCount: number;
          tagName: string;
        } | null;
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
      '[role="article"] svg',
      '[role="article"]',
    ];
    let lastReason = "no selector matched";
    for (const selector of selectors) {
      const node = win.document.querySelector(selector);
      if (!node) {
        lastReason = `no match for ${selector}`;
        continue;
      }
      if (
        node.childElementCount === 0 &&
        node.tagName.toLowerCase() !== "svg"
      ) {
        // SVG can legitimately be a leaf at the cascade-test level
        // (its <circle>/<path> children are inspected by the structural
        // walker). For non-SVG nodes, an empty wrapper is exactly the
        // failure mode this check exists to catch.
        lastReason = `${selector} matched but is an empty wrapper`;
        continue;
      }
      return { selector };
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
 */
export async function readLastAssistantText(page: Page): Promise<string> {
  // Mirror the message-count probe in conversation-runner.ts: prefer
  // the canonical CopilotKit testid, fall back to a `[role="article"]`
  // selector that explicitly EXCLUDES user-tagged bubbles. The
  // exclusion is load-bearing — composers that tag their user bubbles
  // `data-message-role="user"` would otherwise have their input
  // counted as the "last assistant message".
  const code = `
    (() => {
      const doc = globalThis.document;
      const canonical = doc.querySelectorAll(${JSON.stringify(
        ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
      )});
      const list = canonical.length > 0
        ? canonical
        : doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
      if (list.length === 0) return "";
      const last = list[list.length - 1];
      return (last && last.textContent ? last.textContent : "").trim();
    })()
  `;
  const fn = new Function(`return ${code};`) as () => string;
  return await page.evaluate(fn);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
