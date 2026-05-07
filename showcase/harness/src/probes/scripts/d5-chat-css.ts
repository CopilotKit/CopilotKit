/**
 * D5 — chat-css script.
 *
 * Drives `/demos/chat-customization-css` through one user turn and
 * verifies the demo's HALCYON theme is actually applied in the browser
 * by reading computed styles on the user-message and assistant-message
 * bubbles. The demo (see
 * `showcase/integrations/langgraph-python/src/app/demos/chat-customization-css/theme.css`)
 * paints user bubbles with a parchment paper-elevated background and
 * an ember left-border accent (`#c44a1f` → rgb(196, 74, 31)) on the
 * inner `[class*="bg-muted"]` element, plus JetBrains Mono. Assistant
 * messages use Fraunces serif on a transparent background with an
 * ember `::before` rule. A failure here means either the CSS import
 * broke, the `chat-css-demo-scope` wrapper class was lost, or the
 * upstream `.copilotKit*` class names drifted.
 *
 * Three independent signals cover the theme — any one missing trips
 * the assertion with a specific error so operators don't have to
 * guess which layer broke:
 *   1. user bubble's inner element border-left-color contains
 *      `196, 74, 31` (the halcyon-ember rgb anchor)
 *   2. user bubble's inner element font-family contains "JetBrains Mono"
 *   3. assistant bubble's font-family contains "Fraunces"
 *
 * One turn matches the recorded fixture (`chat-css.json`).
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Default `/demos/<featureType>` would be `/demos/chat-css` which does
 *  not exist — the actual route uses the registry-id `chat-customization-css`. */
export function preNavigateRoute(_ft: D5FeatureType): string {
  return "/demos/chat-customization-css";
}

/** User-bubble selector used by both the runner's settle poll and the
 *  computed-style probe. */
export const USER_BUBBLE_SELECTOR = ".copilotKitMessage.copilotKitUserMessage";
/** Assistant-bubble selector. */
export const ASSISTANT_BUBBLE_SELECTOR =
  ".copilotKitMessage.copilotKitAssistantMessage";
/** The user bubble's inner v2 element — paints the halcyon-paper-elevated
 *  background plus the ember left border. The outer message wrapper is
 *  transparent in the new theme; signals all live on this inner node. */
export const USER_BUBBLE_INNER_SELECTOR = `${USER_BUBBLE_SELECTOR} [class*="bg-muted"]`;

/** halcyon-ember rgb anchor (`#c44a1f`) on the user-bubble inner border-left. */
const EMBER_RGB_FRAGMENT = "196, 74, 31";
/** Editorial mono token (`var(--halcyon-mono)`) — JetBrains Mono with
 *  a CSS fallback chain. The fallback covers Linux runners that lack
 *  the webfont, so we accept either the real face or one of the
 *  declared fallbacks. */
const USER_MONO_FONT_FRAGMENTS = [
  "JetBrains Mono",
  // Fallback chain from `--halcyon-mono`.
  "ui-monospace",
  "SF Mono",
  "Menlo",
  "Consolas",
];
/** Editorial serif token (`var(--halcyon-serif)`) — Fraunces with
 *  fallbacks. Same rationale as the mono fragments. */
const ASSISTANT_SERIF_FONT_FRAGMENTS = [
  "Fraunces",
  "Source Serif Pro",
  "ui-serif",
];

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Probe-result shape: per-bubble computed strings. `null` means the
 * selector didn't match, distinct from "matched but wrong style".
 */
export interface ChatCssProbeResult {
  userBorderLeft: string | null;
  userFontFamily: string | null;
  assistantFontFamily: string | null;
}

/** Read computed styles on both bubbles inside the demo scope.
 *
 *  Notes on the page.evaluate body shape:
 *  - We do NOT declare local const-arrows or TS interfaces inside the
 *    evaluated function. tsx (esbuild) injects a `__name(fn, "fn")`
 *    helper to attach names for error stack frames; that helper is
 *    not defined in the browser, so any tagged-name emit causes
 *    `ReferenceError: __name is not defined` at evaluate time.
 *  - Inline-only style (single returns, no helpers) keeps the
 *    transpiled output free of __name calls. */
export async function probeChatCss(page: Page): Promise<ChatCssProbeResult> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelector(sel: string): unknown };
      getComputedStyle(el: unknown): {
        borderLeftColor?: string;
        fontFamily?: string;
      };
    };
    const userOuter = win.document.querySelector(
      ".copilotKitMessage.copilotKitUserMessage",
    );
    // The inner node is the v2 framework's bubble that consumes the
    // `bg-muted` Tailwind utility — the demo's CSS hooks the substring
    // class-match because the upstream Tailwind class composition
    // includes `bg-muted` on the bubble div.
    const userInner = (userOuter as { querySelector?(sel: string): unknown } | null)?.querySelector?.(
      '[class*="bg-muted"]',
    );
    const assistantEl = win.document.querySelector(
      ".copilotKitMessage.copilotKitAssistantMessage",
    );
    const userStyle = userInner ? win.getComputedStyle(userInner) : null;
    const assistantStyle = assistantEl
      ? win.getComputedStyle(assistantEl)
      : null;
    return {
      userBorderLeft: userStyle?.borderLeftColor ?? null,
      userFontFamily: userStyle?.fontFamily ?? null,
      assistantFontFamily: assistantStyle?.fontFamily ?? null,
    };
  })) as ChatCssProbeResult;
}

/** Validate the probe — returns null on pass, error string on fail. */
export function validateChatCss(probe: ChatCssProbeResult): string | null {
  if (probe.userBorderLeft === null || probe.userFontFamily === null) {
    return `chat-css: user bubble inner (${USER_BUBBLE_INNER_SELECTOR}) not found in DOM`;
  }
  if (probe.assistantFontFamily === null) {
    return `chat-css: assistant bubble (${ASSISTANT_BUBBLE_SELECTOR}) not found in DOM`;
  }
  if (!probe.userBorderLeft.includes(EMBER_RGB_FRAGMENT)) {
    return `chat-css: user bubble missing halcyon-ember left border (${EMBER_RGB_FRAGMENT}) — got "${probe.userBorderLeft.slice(0, 200)}"`;
  }
  if (
    !USER_MONO_FONT_FRAGMENTS.some((f) => probe.userFontFamily!.includes(f))
  ) {
    return `chat-css: user bubble missing halcyon-mono font (one of ${USER_MONO_FONT_FRAGMENTS.join(", ")}) — got "${probe.userFontFamily.slice(0, 200)}"`;
  }
  if (
    !ASSISTANT_SERIF_FONT_FRAGMENTS.some((f) =>
      probe.assistantFontFamily!.includes(f),
    )
  ) {
    return `chat-css: assistant bubble missing halcyon-serif font (one of ${ASSISTANT_SERIF_FONT_FRAGMENTS.join(", ")}) — got "${probe.assistantFontFamily.slice(0, 200)}"`;
  }
  return null;
}

export function buildChatCssAssertion(opts?: {
  waitTimeoutMs?: number;
}): (page: Page) => Promise<void> {
  const waitTimeout = opts?.waitTimeoutMs ?? PROBE_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    try {
      await page.waitForSelector(ASSISTANT_BUBBLE_SELECTOR, {
        state: "visible",
        timeout: waitTimeout,
      });
    } catch {
      throw new Error(
        `chat-css: assistant bubble selector ${ASSISTANT_BUBBLE_SELECTOR} did not appear within ${waitTimeout}ms — chat surface may have failed to render`,
      );
    }
    const probe = await probeChatCss(page);
    const err = validateChatCss(probe);
    if (err) throw new Error(err);
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "verify the css theme rendering",
      assertions: buildChatCssAssertion(),
    },
  ];
}

registerD5Script({
  featureTypes: ["chat-css"],
  fixtureFile: "chat-css.json",
  buildTurns,
  preNavigateRoute,
});
