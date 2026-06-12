/**
 * D5 — chat-css script.
 *
 * Drives `/demos/chat-customization-css` through one user turn and
 * verifies the demo's CSS theme is actually applied in the browser.
 * The probe accepts EITHER of two themes — langgraph-python was
 * refactored to "HALCYON" (parchment + ember on the user bubble's
 * inner element + JetBrains Mono / Fraunces fonts), while the other
 * 17 integrations still ship the legacy hot-pink-on-user / amber-on-
 * assistant theme. A failure here means either the CSS import broke,
 * the `chat-css-demo-scope` wrapper class was lost, or the upstream
 * `.copilotKit*` class names drifted.
 *
 * HALCYON path (langgraph-python only):
 *   1. user bubble's inner element border-left-color contains
 *      `196, 74, 31` (the halcyon-ember rgb anchor)
 *   2. user bubble's inner element font-family contains "JetBrains Mono"
 *   3. assistant bubble's font-family contains "Fraunces"
 *
 * Legacy path (the other 17 integrations):
 *   1. user bubble background contains `255, 0, 110` (#ff006e hot pink)
 *   2. assistant bubble background contains `253, 224, 71` (#fde047 amber)
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
 *  transparent in the new theme; signals all live on this inner node.
 *
 *  v2 emits prefixed Tailwind utilities (e.g. `cpk:bg-muted`) on this
 *  bubble, see CopilotChatUserMessage.tsx. Uses `[class~="cpk:bg-muted"]`
 *  (whole-token match on the PREFIXED name) so:
 *    - bare `[class~="bg-muted"]` wouldn't match (token is `cpk:bg-muted`)
 *    - `[class*="bg-muted"]` would also match `cpk:bg-muted-foreground`
 *      on nested children (Reasoning message dots) and read styles off
 *      the wrong element.
 *  The whole-token form on the prefixed string is unambiguous. */
export const USER_BUBBLE_INNER_SELECTOR = `${USER_BUBBLE_SELECTOR} [class~="cpk:bg-muted"]`;

// ── HALCYON theme anchors (langgraph-python) ──────────────────────────
/** halcyon-ember rgb anchor (`#c44a1f`) on the user-bubble inner border-left. */
const HALCYON_EMBER_RGB_FRAGMENT = "196, 74, 31";
/** Editorial mono token (`var(--halcyon-mono)`) — JetBrains Mono with
 *  a CSS fallback chain. The fallback covers Linux runners that lack
 *  the webfont, so we accept either the real face or one of the
 *  declared fallbacks. */
const HALCYON_USER_MONO_FONT_FRAGMENTS = [
  "JetBrains Mono",
  "ui-monospace",
  "SF Mono",
  "Menlo",
  "Consolas",
];
/** Editorial serif token (`var(--halcyon-serif)`) — Fraunces with
 *  fallbacks. Same rationale as the mono fragments. */
const HALCYON_ASSISTANT_SERIF_FONT_FRAGMENTS = [
  "Fraunces",
  "Source Serif Pro",
  "ui-serif",
];

// ── Legacy theme anchors (the other 17 integrations) ──────────────────
/** Hot-pink rgb (`#ff006e`) on the legacy user-bubble background. */
const LEGACY_USER_RGB_FRAGMENT = "255, 0, 110";
/** Amber rgb (`#fde047`) on the legacy assistant-bubble background. */
const LEGACY_ASSISTANT_RGB_FRAGMENT = "253, 224, 71";

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Probe-result shape. `null` means the selector didn't match, distinct
 * from "matched but wrong style". HALCYON path consumes `userBorderLeft`,
 * `userFontFamily`, `assistantFontFamily`. Legacy path consumes
 * `userBackground`, `assistantBackground`. Both are read on every probe
 * so the validator can pick a path without a second round-trip.
 */
export interface ChatCssProbeResult {
  // HALCYON anchors
  userBorderLeft: string | null;
  userFontFamily: string | null;
  assistantFontFamily: string | null;
  // Legacy anchors
  userBackground: string | null;
  assistantBackground: string | null;
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
        background?: string;
        backgroundColor?: string;
      };
    };
    const userOuter = win.document.querySelector(
      ".copilotKitMessage.copilotKitUserMessage",
    );
    // The inner node is v2's CopilotChatUserMessage bubble. v2 emits
    // PREFIXED Tailwind classes (`cpk:bg-muted`), so we whole-token-
    // match on the prefixed name — see USER_BUBBLE_INNER_SELECTOR docs.
    const userInner = (
      userOuter as { querySelector?(sel: string): unknown } | null
    )?.querySelector?.('[class~="cpk:bg-muted"]');
    const assistantEl = win.document.querySelector(
      ".copilotKitMessage.copilotKitAssistantMessage",
    );
    // HALCYON anchors live on the inner node; legacy anchors live on
    // the outer wrapper. Read both so the validator picks the path.
    const userInnerStyle = userInner ? win.getComputedStyle(userInner) : null;
    const userOuterStyle = userOuter ? win.getComputedStyle(userOuter) : null;
    const assistantStyle = assistantEl
      ? win.getComputedStyle(assistantEl)
      : null;
    const userBackgroundCombined = userOuterStyle
      ? `${userOuterStyle.background ?? ""} ${userOuterStyle.backgroundColor ?? ""}`.trim()
      : null;
    const assistantBackgroundCombined = assistantStyle
      ? `${assistantStyle.background ?? ""} ${assistantStyle.backgroundColor ?? ""}`.trim()
      : null;
    return {
      userBorderLeft: userInnerStyle?.borderLeftColor ?? null,
      userFontFamily: userInnerStyle?.fontFamily ?? null,
      assistantFontFamily: assistantStyle?.fontFamily ?? null,
      userBackground: userBackgroundCombined,
      assistantBackground: assistantBackgroundCombined,
    };
  })) as ChatCssProbeResult;
}

interface PathError {
  path: "halcyon" | "legacy";
  reason: string;
}

/** Try the HALCYON path; null on pass, structured error on fail. */
function tryHalcyon(probe: ChatCssProbeResult): PathError | null {
  if (probe.userBorderLeft === null || probe.userFontFamily === null) {
    return {
      path: "halcyon",
      reason: `user bubble inner (${USER_BUBBLE_INNER_SELECTOR}) not found in DOM`,
    };
  }
  if (probe.assistantFontFamily === null) {
    return {
      path: "halcyon",
      reason: `assistant bubble (${ASSISTANT_BUBBLE_SELECTOR}) not found in DOM`,
    };
  }
  if (!probe.userBorderLeft.includes(HALCYON_EMBER_RGB_FRAGMENT)) {
    return {
      path: "halcyon",
      reason: `user bubble missing halcyon-ember left border (${HALCYON_EMBER_RGB_FRAGMENT}) — got "${probe.userBorderLeft.slice(0, 120)}"`,
    };
  }
  if (
    !HALCYON_USER_MONO_FONT_FRAGMENTS.some((f) =>
      probe.userFontFamily!.includes(f),
    )
  ) {
    return {
      path: "halcyon",
      reason: `user bubble missing halcyon-mono font — got "${probe.userFontFamily.slice(0, 120)}"`,
    };
  }
  if (
    !HALCYON_ASSISTANT_SERIF_FONT_FRAGMENTS.some((f) =>
      probe.assistantFontFamily!.includes(f),
    )
  ) {
    return {
      path: "halcyon",
      reason: `assistant bubble missing halcyon-serif font — got "${probe.assistantFontFamily.slice(0, 120)}"`,
    };
  }
  return null;
}

/** Try the legacy path; null on pass, structured error on fail. */
function tryLegacy(probe: ChatCssProbeResult): PathError | null {
  if (probe.userBackground === null) {
    return {
      path: "legacy",
      reason: `user bubble (${USER_BUBBLE_SELECTOR}) not found in DOM`,
    };
  }
  if (probe.assistantBackground === null) {
    return {
      path: "legacy",
      reason: `assistant bubble (${ASSISTANT_BUBBLE_SELECTOR}) not found in DOM`,
    };
  }
  if (!probe.userBackground.includes(LEGACY_USER_RGB_FRAGMENT)) {
    return {
      path: "legacy",
      reason: `user bubble background missing red/pink anchor (${LEGACY_USER_RGB_FRAGMENT}) — got "${probe.userBackground.slice(0, 120)}"`,
    };
  }
  if (!probe.assistantBackground.includes(LEGACY_ASSISTANT_RGB_FRAGMENT)) {
    return {
      path: "legacy",
      reason: `assistant bubble background missing yellow/amber anchor (${LEGACY_ASSISTANT_RGB_FRAGMENT}) — got "${probe.assistantBackground.slice(0, 120)}"`,
    };
  }
  return null;
}

/** Validate the probe — returns null on pass (either path), error string
 *  on fail (both paths). The error includes both path-specific reasons
 *  so operators can see WHICH theme the integration was supposed to
 *  match against and what failed. */
export function validateChatCss(probe: ChatCssProbeResult): string | null {
  const halcyonErr = tryHalcyon(probe);
  if (halcyonErr === null) return null; // HALCYON theme matched
  const legacyErr = tryLegacy(probe);
  if (legacyErr === null) return null; // Legacy theme matched
  return `chat-css: neither HALCYON nor legacy theme matched — halcyon: ${halcyonErr.reason} | legacy: ${legacyErr.reason}`;
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
