import { CopilotKitCoreErrorCode } from "@copilotkit/core";

import type { MenuKey } from "./inspector-nav.js";
import type {
  InspectorErrorSignalSource,
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
} from "./telemetry.js";

/** Menu key of the What's new leaf — the news signal's destination. */
export const WHATS_NEW_MENU_KEY = "whats-new";

// ── Launcher signals ──────────────────────────────────────────────────────
//
// There is one dot on the closed launcher and more than one thing that can
// claim it, so each subject is described once, here, and every call site reads
// the description rather than hardcoding a subject.
//
// The rule for this table is **no field without a second consumer**. That is
// why there is no lifecycle field (one value was ever used, and "never
// persisted" is expressed by not persisting) and why the two destinations are
// separate: the news signal genuinely marks one entry and lands on another.
//
// This reintroduces a small shared shape where an earlier generic version was
// removed as speculative. That removal was correct at the time — the
// abstraction had exactly one user. A second user now exists.
//
// **The two subjects beat by different rules, deliberately**: an error beats
// once per outage, an announcement once per tab per announcement. That follows
// from a recurring condition versus a one-time publication. Do not harmonise
// them; harmonising breaks one of them.

/** Tone drives colour only. The launcher treatment is shared by every tone. */
export type LauncherSignalTone = "news" | "error";

/**
 * The error keys ARE the telemetry enum, so a source can never be reported
 * under a name the signal table does not describe.
 */
export type LauncherSignalKey = "whats-new" | InspectorErrorSignalSource;

export type LauncherSignalDefinition = Readonly<{
  tone: LauncherSignalTone;
  /** Which navigation entry carries the marker while this signal is armed. */
  markerTarget: MenuKey;
  /** Where a press on the launcher opens while this signal owns the dot. */
  landingTarget: MenuKey;
  /** One beat's duration. Errors beat faster than product news. */
  cadence: number;
  /** Higher wins the single dot. Errors outrank news. */
  priority: number;
  /**
   * Suffix appended to the marked navigation entry's accessible name, and —
   * for error tones only — to the launcher's own accessible name. Never
   * rendered as visible text: the dot says there is something to look at, and
   * the panel says what.
   */
  accessibleLabel: string;
  /**
   * The words the launcher opens sideways to show, and the words spoken once
   * into the polite live region. Absent means this subject opens no pill.
   *
   * Read from the signal rather than from a condition on the tone, so a third
   * signal can carry a pill by declaring one — and whoever declares it owns
   * the width problem that keeps the announcement out. The announcement's feed
   * preview measures 54 characters against a 36-pixel launcher, and the width
   * would be set by a feed we do not control.
   *
   * These are the words the panel already uses, never a paraphrase, so a
   * reader who sees the pill and then opens the panel has nothing to
   * reconcile. The failure *message* is never carried here — for width, and
   * because it can contain prompts, URLs and identifiers.
   */
  pillLabel?: string;
}>;

export const NEWS_SIGNAL_ID = "whats-new" as const;
export const NEWS_SIGNAL_COLOR = "#A78BFA";
/**
 * The error tone's red. Bright enough to read against the launcher's dark
 * face at the same perceived weight as the news lilac, and in the same family
 * as System Health's error tone (#b32d3b light / #ff9aa0 dark), which is too
 * dark and too pale respectively to use directly on the launcher.
 */
export const ERROR_SIGNAL_COLOR = "#F87171";

export const LAUNCHER_SIGNAL_COLORS: Readonly<
  Record<LauncherSignalTone, string>
> = {
  news: NEWS_SIGNAL_COLOR,
  error: ERROR_SIGNAL_COLOR,
};

/**
 * The failure gesture, four phases in series:
 *
 * ```
 * beat 400ms  →  open 250ms  →  hold 2500ms  →  close 250ms   (3400ms total)
 * ```
 *
 * Sequential rather than simultaneous, deliberately: the beat says *here*, the
 * pill says *this*. The beat is short so the words arrive quickly.
 *
 * **All four durations live here and nowhere else.** The stylesheet reads the
 * two animated phases as custom properties injected from these numbers rather
 * than restating them, because they are taste and will be tuned by eye after
 * the first live look — tuning the feel must be a number, not a refactor.
 */
export const ERROR_GESTURE_MS = {
  /** Phase 1: one beat, which is also the error signals' cadence. */
  beat: 400,
  /** Phase 2: the sideways reveal. */
  open: 250,
  /** Phase 3: long enough to read three words without hurrying. */
  hold: 2500,
  /** Phase 4: back to the plain mark with its dot. */
  close: 250,
} as const;

/**
 * The words the pill carries, which are the words the panel already carries.
 *
 * `Runtime error` is the System Health runtime tile's own label, and
 * `Failed to load threads` is the Threads view's own heading. The outside and
 * the inside must agree, so these are shared rather than paraphrased.
 */
export const RUNTIME_ERROR_LABEL = "Runtime error";
export const THREADS_LOAD_ERROR_LABEL = "Failed to load threads";
export const AGENT_RUN_FAILED_LABEL = "Agent run failed";
export const TOOL_ERROR_LABEL = "Tool error";
export const MEMORY_LOAD_ERROR_LABEL = "Failed to load learning data";

/**
 * Copy on the landing view. Titles match the pill.
 *
 * The two fields differ in what they can promise. `advice` is about the
 * reader's next move and is always true. `highlight` is a claim about *this
 * view* — that the failed item is visible below — and the error carries no
 * guarantee of that: a code mapped to `run` can arrive with no run in the
 * buffer at all, and a tool error can arrive without the call id the
 * highlight needs. So it is rendered only once the item is actually there.
 * A card pointing at something the reader cannot find is worse than a card
 * that stays quiet, because it sends them looking.
 */
export const EVENT_ERROR_GUIDANCE: Readonly<
  Record<
    InspectorEventErrorSource,
    Readonly<{ title: string; advice?: string; highlight?: string }>
  >
> = {
  run: {
    title: AGENT_RUN_FAILED_LABEL,
    highlight: "The failed run event is highlighted below.",
  },
  tool: {
    title: TOOL_ERROR_LABEL,
    highlight: "The failed tool call is highlighted below.",
  },
  memory: {
    title: MEMORY_LOAD_ERROR_LABEL,
    advice:
      "Confirm CopilotKit Intelligence is connected, then retry Learning.",
  },
};

/**
 * The pill's second line, shared by every subject that carries a pill.
 *
 * **This is the one string in the feature that exists nowhere else in the
 * product.** Every other word the launcher shows is word-identical to the
 * panel, which is the standing rule; this line is a deliberate, owner-approved
 * exception to it, because the pill became clickable and an invitation that
 * says nothing is not an invitation.
 *
 * It is shown, never spoken: the polite live region carries the failure class
 * alone. A screen-reader user cannot act on an instruction delivered through
 * an announcement, and it would double the spoken length.
 */
export const PILL_SUBLINE_LABEL = "Open Inspector for details";

export type LauncherHudRowId =
  | "inspector"
  | "threads"
  | "intelligence"
  | "learning";

export const HUD_OPEN_INSPECTOR_LABEL = "Open Inspector";
export const HUD_THREADS_OFF_LABEL = "Turn on Threads";
export const HUD_THREADS_ON_LABEL = "Threads on";
export const HUD_INTELLIGENCE_OFF_LABEL = "Turn on Intelligence";
export const HUD_INTELLIGENCE_ON_LABEL = "Intelligence connected";
export const HUD_THREADS_OFF_DETAIL = "Inspect conversations from this app.";
export const HUD_THREADS_ON_DETAIL = "Threads is on. Opens the Threads view.";
export const HUD_INTELLIGENCE_OFF_DETAIL =
  "Connect Intelligence to use Threads and Learning.";
export const HUD_INTELLIGENCE_ON_DETAIL =
  "Intelligence is connected. Opens Home.";
export const HUD_LEARNING_OFF_LABEL = "Turn on Learning";
export const HUD_LEARNING_ON_LABEL = "Learning on";
export const HUD_LEARNING_OFF_DETAIL = "Connect Intelligence to use Learning.";
export const HUD_LEARNING_ON_DETAIL =
  "Learning is on. Opens the Learning view.";
export const HUD_OPEN_INSPECTOR_DETAIL =
  "Same as clicking the circle. Opens the full Inspector.";

export const LAUNCHER_SIGNALS: Readonly<
  Record<LauncherSignalKey, LauncherSignalDefinition>
> = {
  // Marks What's new, lands on Home: Home carries the preview band that is
  // the way onward. Unchanged from before this table existed.
  "whats-new": {
    tone: "news",
    markerTarget: WHATS_NEW_MENU_KEY,
    landingTarget: "home",
    cadence: 2100,
    priority: 0,
    accessibleLabel: "new content",
  },
  // Errors mark and land on the same place, because the place that carries
  // the marker is the place that explains the failure.
  connection: {
    tone: "error",
    markerTarget: "home",
    landingTarget: "home",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 5,
    accessibleLabel: "runtime error",
    pillLabel: RUNTIME_ERROR_LABEL,
  },
  threads: {
    tone: "error",
    markerTarget: "threads",
    landingTarget: "threads",
    cadence: ERROR_GESTURE_MS.beat,
    // Below the connection signal: a connection failure cascades into thread
    // failures, so when both could be armed the root cause owns the dot.
    priority: 4,
    accessibleLabel: "thread loading error",
    pillLabel: THREADS_LOAD_ERROR_LABEL,
  },
  // Unread *events*. They beat and name the failure, then clear when the
  // landing view is read. They lose the launcher dot to wiring state.
  run: {
    tone: "error",
    markerTarget: "ag-ui-events",
    landingTarget: "ag-ui-events",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 3,
    accessibleLabel: "agent run failed",
    pillLabel: AGENT_RUN_FAILED_LABEL,
  },
  tool: {
    tone: "error",
    markerTarget: "agents",
    landingTarget: "agents",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 2,
    accessibleLabel: "tool error",
    pillLabel: TOOL_ERROR_LABEL,
  },
  memory: {
    tone: "error",
    markerTarget: "memories",
    landingTarget: "memories",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 1,
    accessibleLabel: "learning error",
    pillLabel: MEMORY_LOAD_ERROR_LABEL,
  },
};

/** Highest priority first, so the winner of the single dot is the head. */
export const LAUNCHER_SIGNAL_PRIORITY_ORDER: ReadonlyArray<LauncherSignalKey> =
  (Object.keys(LAUNCHER_SIGNALS) as LauncherSignalKey[]).sort(
    (a, b) => LAUNCHER_SIGNALS[b].priority - LAUNCHER_SIGNALS[a].priority,
  );

/** Wiring *state* — red until the problem heals. */
export const WIRING_ERROR_KEYS = [
  "connection",
  "threads",
] as const satisfies ReadonlyArray<InspectorWiringErrorSource>;

/** Unread *events* — red until the landing view is read. */
export const EVENT_ERROR_KEYS = [
  "run",
  "tool",
  "memory",
] as const satisfies ReadonlyArray<InspectorEventErrorSource>;

export type InspectorEventErrorDetails = Readonly<{
  message: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
}>;

export function isWiringErrorKey(
  key: LauncherSignalKey,
): key is InspectorWiringErrorSource {
  return (WIRING_ERROR_KEYS as readonly string[]).includes(key);
}

/**
 * Takes a plain string rather than a `LauncherSignalKey`, because one caller
 * reads the subject back out of a `data-` attribute, where the DOM can only
 * offer `string | undefined`. Narrowing untrusted input is what a guard is
 * for; `LauncherSignalKey` still satisfies the parameter, so the callers that
 * already hold one are unaffected.
 */
export function isEventErrorKey(key: string): key is InspectorEventErrorSource {
  return (EVENT_ERROR_KEYS as readonly string[]).includes(key);
}

/** Narrows a signal key to an error source, excluding the announcement. */
export function isErrorSignalKey(
  key: LauncherSignalKey,
): key is InspectorErrorSignalSource {
  return isWiringErrorKey(key) || isEventErrorKey(key);
}

/**
 * The control range is the point, not an oversight: an attribute selector has
 * to escape those characters too, and CSS.escape — which the fallback below
 * stands in for — escapes them as well. Hoisted so the suppression can sit on
 * the pattern rather than three lines above it.
 */
// oxlint-disable no-control-regex -- deliberate, see above
export const SELECTOR_ESCAPE_PATTERN =
  /[\0-\x1f\x7f!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
// oxlint-enable no-control-regex

/** Attribute selector value. jsdom does not implement CSS.escape. */
export function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(SELECTOR_ESCAPE_PATTERN, "\\$&");
}

export function eventErrorKeyForCode(
  code: CopilotKitCoreErrorCode,
): InspectorEventErrorSource | null {
  switch (code) {
    case CopilotKitCoreErrorCode.TOOL_NOT_FOUND:
    case CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED:
    case CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED:
    case CopilotKitCoreErrorCode.AGENT_NOT_FOUND:
      return "tool";
    case CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED:
    case CopilotKitCoreErrorCode.AGENT_RUN_FAILED:
    case CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT:
    case CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT:
      return "run";
    default:
      return null;
  }
}

/**
 * Coalesce inspector-owned GET /threads sends. The first refresh goes out
 * at once. Further calls in this window share one trailing request, so a
 * flaky network does not fire a burst of list fetches and error cards.
 */
