/**
 * The pre-paint lifecycle of an `a2ui-surface` activity (OSS-162).
 *
 * The A2UI middleware drives the whole generative-UI lifecycle on one activity
 * (one stable messageId, `replace: true`), so the states swap in place and the
 * painted surface finally replaces them:
 *
 *   building  → skeleton + "Building interface" (+ optional ~N tokens)
 *   retrying  → the same skeleton; once the retry is perceptible the label
 *               becomes "Retrying generation… (N/M attempts)", so a fast
 *               transient retry never flashes
 *   failed    → a failure card, with developer detail per `debugExposure`
 *   painted   → the surface renders; a hand-off keeps the loader on screen
 *               until the surface has painted, so there is no gap
 *
 * Timing (`showAfterMs` / `showAfterAttempts`) and how much debug detail to
 * show (`debugExposure`) are client options; the server can override
 * `debugExposure` by stamping it on the content.
 */
import type { StandardSchemaV1 } from "@copilotkit/shared";
import {
  A2UI_PAINT_FALLBACK_MS,
  diagnoseUnpaintedSurface,
} from "./diagnostics";
import type { A2UIOperation } from "./operations";
import {
  getA2UIOperations,
  groupA2UIOperationsBySurface,
  isRecord,
  surfaceHasRenderableContent,
} from "./operations";

export type A2UIDebugExposure = "hidden" | "collapsed" | "verbose";
export type A2UILifecycleStatus = "building" | "retrying" | "failed";

/** The lifecycle fields the middleware stamps on `a2ui-surface` content. */
export interface A2UILifecycle {
  status: A2UILifecycleStatus;
  attempt?: number;
  maxAttempts?: number;
  progressTokens?: number;
  error?: string;
  errors?: unknown[];
  attempts?: unknown[];
  debugExposure?: A2UIDebugExposure;
}

/** Client options for the pre-paint recovery and loading UX. */
export interface A2UIRecoveryOptions {
  /** Delay (ms) before the "Retrying…" label becomes visible. Default 2000. */
  showAfterMs?: number;
  /** Show the "Retrying…" label at once when `attempt` reaches this. Default 2. */
  showAfterAttempts?: number;
  /** How much retry and debug detail to show. Default "collapsed". */
  debugExposure?: A2UIDebugExposure;
}

export const A2UI_RECOVERY_DEFAULTS = {
  showAfterMs: 2000,
  showAfterAttempts: 2,
  debugExposure: "collapsed",
  paintFallbackMs: A2UI_PAINT_FALLBACK_MS,
} satisfies Required<A2UIRecoveryOptions> & { paintFallbackMs: number };

/** User-visible text of the lifecycle states. */
export const A2UI_LIFECYCLE_TEXT = {
  building: "Building interface",
  retrying: "Retrying generation…",
  failureTitle: "Couldn't generate the UI",
  failureDescription:
    "Something went wrong rendering this. You can keep chatting and try again.",
  failureDetails: "developer details",
  retryDetails: "validation issues",
};

function isDebugExposure(value: unknown): value is A2UIDebugExposure {
  return value === "hidden" || value === "collapsed" || value === "verbose";
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function arrayOrUndefined(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Reads the lifecycle fields from activity content. An unknown or missing
 * `status` reads as "building"; fields of the wrong type are left out.
 *
 * @param content - `a2ui-surface` activity content, of any shape.
 */
export function readA2UILifecycle(content: unknown) {
  if (!isRecord(content)) {
    const building: A2UILifecycle = { status: "building" };
    return building;
  }
  const status: A2UILifecycleStatus =
    content.status === "retrying" || content.status === "failed"
      ? content.status
      : "building";
  const lifecycle: A2UILifecycle = {
    status,
    attempt: numberOrUndefined(content.attempt),
    maxAttempts: numberOrUndefined(content.maxAttempts),
    progressTokens: numberOrUndefined(content.progressTokens),
    error: typeof content.error === "string" ? content.error : undefined,
    errors: arrayOrUndefined(content.errors),
    attempts: arrayOrUndefined(content.attempts),
    debugExposure: isDebugExposure(content.debugExposure)
      ? content.debugExposure
      : undefined,
  };
  return lifecycle;
}

/**
 * `a2ui-surface` activity content: lifecycle fields before paint,
 * `a2ui_operations` on paint, and any future fields.
 */
export type A2UISurfaceContent = Record<string, unknown>;

/**
 * Validates `a2ui-surface` activity content for activity renderer
 * registration. Any object passes: {@link readA2UILifecycle} and
 * `getA2UIOperations` read the fields and ignore mistyped ones, so a field
 * a newer middleware adds can never hide the surface.
 */
export const A2UI_SURFACE_CONTENT_SCHEMA: StandardSchemaV1<
  unknown,
  A2UISurfaceContent
> = {
  "~standard": {
    version: 1,
    vendor: "copilotkit",
    validate: (value) =>
      isRecord(value)
        ? { value }
        : { issues: [{ message: "a2ui-surface content must be an object" }] },
  },
};

/**
 * The debug exposure to use: the server-stamped one wins, then the client
 * option, then "collapsed".
 */
export function resolveA2UIDebugExposure(
  lifecycle: A2UILifecycle,
  option?: A2UIDebugExposure,
) {
  return (
    lifecycle.debugExposure ?? option ?? A2UI_RECOVERY_DEFAULTS.debugExposure
  );
}

/** The skeleton rows a progress phase reveals; 0 is the first row pair. */
export type A2UIProgressPhase = 0 | 1 | 2 | 3;

/**
 * How much of the skeleton to reveal for an estimated token count. With no
 * count yet the full skeleton shows rather than an empty box.
 *
 * @param tokens - The streamed token estimate, if the server sent one.
 */
export function getA2UIProgressPhase(tokens: number | undefined) {
  let phase: A2UIProgressPhase = 3;
  if (tokens === undefined) return phase;
  if (tokens < 50) phase = 0;
  else if (tokens < 200) phase = 1;
  else if (tokens < 400) phase = 2;
  return phase;
}

/**
 * The label under the skeleton: "Building interface" until a retry is
 * revealed, then "Retrying generation…", with the attempt count when known.
 */
export function formatA2UIRetryLabel(
  lifecycle: A2UILifecycle,
  retryRevealed: boolean,
) {
  if (lifecycle.status !== "retrying" || !retryRevealed) {
    return A2UI_LIFECYCLE_TEXT.building;
  }
  const { attempt, maxAttempts } = lifecycle;
  if (attempt === undefined || maxAttempts === undefined) {
    return A2UI_LIFECYCLE_TEXT.retrying;
  }
  return `${A2UI_LIFECYCLE_TEXT.retrying} (${String(attempt)}/${String(maxAttempts)} attempts)`;
}

/**
 * Serializes a debug payload for display. Never throws: circular references,
 * functions, bigints and symbols get placeholder text.
 */
export function formatA2UIDebugPayload(value: unknown) {
  if (typeof value === "string") return value;
  const seen = new WeakSet();
  try {
    const serialized = JSON.stringify(
      value,
      (_key, candidate: unknown) => {
        if (typeof candidate === "bigint") return `${candidate.toString()}n`;
        if (typeof candidate === "function") return "[Function]";
        if (typeof candidate === "symbol") return candidate.toString();
        if (typeof candidate === "object" && candidate !== null) {
          if (seen.has(candidate)) return "[Circular]";
          seen.add(candidate);
        }
        return candidate;
      },
      2,
    );
    return serialized ?? String(value);
  } catch {
    return "[Unserializable value]";
  }
}

/** One skeleton bar: width (px), colour and animation delay (s). */
export interface A2UISkeletonBar {
  readonly w: number;
  readonly bg: string;
  readonly anim: number;
}
export type A2UISkeletonPart = "dot" | "spacer" | A2UISkeletonBar;

/** The skeleton rows; each row shows once the progress phase reaches `phase`. */
export const A2UI_SKELETON_ROWS: readonly {
  readonly phase: A2UIProgressPhase;
  readonly delay: number;
  readonly parts: readonly A2UISkeletonPart[];
}[] = [
  {
    phase: 0,
    delay: 0,
    parts: [
      { w: 36, bg: "rgba(147,197,253,0.7)", anim: 0 },
      { w: 80, bg: "rgba(219,234,254,0.8)", anim: 0.2 },
    ],
  },
  {
    phase: 0,
    delay: 0.1,
    parts: ["spacer", "dot", { w: 100, bg: "rgba(24,24,27,0.2)", anim: 0.3 }],
  },
  {
    phase: 1,
    delay: 0.15,
    parts: [
      "spacer",
      { w: 48, bg: "rgba(24,24,27,0.15)", anim: 0.1 },
      { w: 40, bg: "rgba(153,246,228,0.6)", anim: 0.5 },
      { w: 56, bg: "rgba(147,197,253,0.6)", anim: 0.3 },
    ],
  },
  {
    phase: 1,
    delay: 0.2,
    parts: ["spacer", "dot", { w: 60, bg: "rgba(24,24,27,0.15)", anim: 0.4 }],
  },
  {
    phase: 2,
    delay: 0.25,
    parts: [
      { w: 40, bg: "rgba(153,246,228,0.5)", anim: 0.2 },
      "dot",
      { w: 48, bg: "rgba(24,24,27,0.15)", anim: 0.6 },
      { w: 64, bg: "rgba(147,197,253,0.5)", anim: 0.1 },
    ],
  },
  {
    phase: 2,
    delay: 0.3,
    parts: [
      { w: 36, bg: "rgba(147,197,253,0.6)", anim: 0.5 },
      { w: 36, bg: "rgba(24,24,27,0.12)", anim: 0.7 },
    ],
  },
  {
    phase: 3,
    delay: 0.35,
    parts: [
      "dot",
      { w: 44, bg: "rgba(24,24,27,0.18)", anim: 0.3 },
      "dot",
      { w: 56, bg: "rgba(153,246,228,0.5)", anim: 0.8 },
      { w: 48, bg: "rgba(147,197,253,0.5)", anim: 0.4 },
    ],
  },
];

/**
 * What an `a2ui-surface` activity shows:
 * - "lifecycle": no operations yet; render the lifecycle state.
 * - "handoff": operations arrived; render the surface hidden and keep the
 *   lifecycle state on top until the surface paints.
 * - "surface": render the surface only.
 */
export type A2UIActivityView = "lifecycle" | "handoff" | "surface";

export interface A2UIActivitySnapshot {
  view: A2UIActivityView;
  /** The operations of the current content. */
  operations: readonly A2UIOperation[];
  /** The lifecycle state to show: the current one, or the last before paint. */
  lifecycle: A2UILifecycle;
  debugExposure: A2UIDebugExposure;
  /** Whether a retry has become perceptible. */
  retryRevealed: boolean;
  /** The label under the skeleton. */
  label: string;
  progressPhase: A2UIProgressPhase;
  /** Whether to show the debug details expander. */
  showDebugDetails: boolean;
  /** Whether the debug details expander starts open. */
  debugDetailsOpen: boolean;
  /** The summary text of the debug details expander. */
  debugDetailsLabel: string;
  /** The formatted debug payload. */
  debugPayload: string;
}

/** Runs `callback` after `ms`; returns a function that cancels it. */
export type A2UIScheduler = (callback: () => void, ms: number) => () => void;

export interface A2UIActivityControllerOptions {
  recovery?: A2UIRecoveryOptions;
  /**
   * Receives development diagnostics (a surface that never painted). Pass
   * `console.warn` in development builds; leave it out in production.
   */
  warn?: (message: string) => void;
  /** Timer to use. Default `setTimeout`. Pass a no-op one during SSR. */
  schedule?: A2UIScheduler;
  /** Runs `callback` after the next paint. Default `requestAnimationFrame`. */
  requestFrame?: (callback: () => void) => void;
}

const defaultSchedule: A2UIScheduler = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

function defaultRequestFrame(callback: () => void) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => callback());
  } else {
    callback();
  }
}

const BUILDING: A2UILifecycle = { status: "building" };

/**
 * Drives what an `a2ui-surface` activity shows: the lifecycle state before
 * paint, the hand-off while the surface paints hidden, then the surface.
 *
 * Give it each content snapshot with `setContent()`, and call `markRendered()`
 * every time the surface applied operations. A surface counts as painted once
 * its operations are renderable (see `surfaceHasRenderableContent`) and a
 * frame has passed; if that never happens the hand-off ends after 8 s anyway
 * and `warn` reports why.
 *
 * @example
 * ```ts
 * const controller = new ɵA2UIActivityController({ recovery });
 * controller.subscribe(() => render(controller.getSnapshot()));
 * controller.setContent(content);
 * // after the surface processed operations:
 * controller.markRendered();
 * // on unmount:
 * controller.dispose();
 * ```
 */
export class A2UIActivityController {
  readonly #listeners = new Set<() => void>();
  readonly #showAfterMs: number;
  readonly #showAfterAttempts: number;
  readonly #debugExposureOption: A2UIDebugExposure | undefined;
  readonly #warn: ((message: string) => void) | undefined;
  readonly #schedule: A2UIScheduler;
  readonly #requestFrame: (callback: () => void) => void;
  #content: unknown = undefined;
  #operations: readonly A2UIOperation[] = [];
  #lifecycle: A2UILifecycle = BUILDING;
  #retryRevealed = false;
  #cancelRetryTimer: (() => void) | undefined;
  #surfaceReady = false;
  #paintRequested = false;
  #cancelFallback: (() => void) | undefined;
  /** Bumped by `dispose()`, so callbacks scheduled before it do nothing. */
  #generation = 0;
  #snapshot: A2UIActivitySnapshot;

  constructor(options: A2UIActivityControllerOptions = {}) {
    const recovery = options.recovery ?? {};
    this.#showAfterMs =
      recovery.showAfterMs ?? A2UI_RECOVERY_DEFAULTS.showAfterMs;
    this.#showAfterAttempts =
      recovery.showAfterAttempts ?? A2UI_RECOVERY_DEFAULTS.showAfterAttempts;
    this.#debugExposureOption = recovery.debugExposure;
    this.#warn = options.warn;
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#requestFrame = options.requestFrame ?? defaultRequestFrame;
    this.#snapshot = this.#buildSnapshot();
  }

  /** The current snapshot. The same object until something changes. */
  getSnapshot = () => this.#snapshot;

  /** Calls `listener` when the snapshot changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Sets the latest activity content. */
  setContent(content: unknown) {
    if (content === this.#content) return;
    this.#content = content;
    const hadOperations = this.#operations.length > 0;
    this.#operations = getA2UIOperations(content);

    if (this.#operations.length === 0) {
      this.#lifecycle = readA2UILifecycle(content);
      this.#updateRetry();
      if (hadOperations) this.#resetHandoff();
    } else if (!hadOperations) {
      this.#startHandoff();
    }
    this.#emit();
  }

  /**
   * Reports that the surface applied operations. Ends the hand-off after the
   * next frame once the operations can paint something.
   */
  markRendered() {
    if (this.#paintRequested || this.#surfaceReady) return;
    if (this.#operations.length === 0) return;
    if (!surfaceHasRenderableContent(this.#operations)) return;
    this.#paintRequested = true;
    const generation = this.#generation;
    this.#requestFrame(() => {
      if (generation !== this.#generation || !this.#paintRequested) return;
      this.#cancelFallback?.();
      this.#cancelFallback = undefined;
      this.#surfaceReady = true;
      this.#emit();
    });
  }

  /**
   * Stops the timers and forgets the content. A later `setContent()` starts
   * again, so a component that remounts can keep using the controller.
   */
  dispose() {
    this.#generation += 1;
    this.#cancelRetryTimer?.();
    this.#cancelRetryTimer = undefined;
    this.#resetHandoff();
    this.#content = undefined;
    this.#operations = [];
    this.#lifecycle = BUILDING;
    this.#retryRevealed = false;
    this.#snapshot = this.#buildSnapshot();
  }

  #updateRetry() {
    const { status, attempt } = this.#lifecycle;
    if (status !== "retrying") {
      this.#cancelRetryTimer?.();
      this.#cancelRetryTimer = undefined;
      this.#retryRevealed = false;
      return;
    }
    const reachedAttempts =
      attempt !== undefined && attempt >= this.#showAfterAttempts;
    if (reachedAttempts) {
      this.#cancelRetryTimer?.();
      this.#cancelRetryTimer = undefined;
      this.#retryRevealed = true;
      return;
    }
    // A new snapshot of the same retry (e.g. a streamed token count) keeps the
    // running timer, so streaming cannot keep the retry hidden.
    if (this.#retryRevealed || this.#cancelRetryTimer) return;
    this.#cancelRetryTimer = this.#schedule(() => {
      this.#cancelRetryTimer = undefined;
      this.#retryRevealed = true;
      this.#emit();
    }, this.#showAfterMs);
  }

  #startHandoff() {
    this.#surfaceReady = false;
    this.#paintRequested = false;
    this.#cancelFallback?.();
    this.#cancelFallback = this.#schedule(() => {
      this.#cancelFallback = undefined;
      if (!this.#paintRequested) this.#reportUnpainted();
      this.#surfaceReady = true;
      this.#emit();
    }, A2UI_RECOVERY_DEFAULTS.paintFallbackMs);
  }

  #resetHandoff() {
    this.#cancelFallback?.();
    this.#cancelFallback = undefined;
    this.#surfaceReady = false;
    this.#paintRequested = false;
  }

  #reportUnpainted() {
    const warn = this.#warn;
    if (!warn) return;
    const groups = groupA2UIOperationsBySurface(this.#operations);
    for (const [surfaceId, operations] of groups) {
      const message = diagnoseUnpaintedSurface(surfaceId, operations);
      if (message) warn(message);
    }
  }

  #emit() {
    this.#snapshot = this.#buildSnapshot();
    for (const listener of this.#listeners) listener();
  }

  #buildSnapshot() {
    const lifecycle = this.#lifecycle;
    const debugExposure = resolveA2UIDebugExposure(
      lifecycle,
      this.#debugExposureOption,
    );
    const isFailed = lifecycle.status === "failed";
    const hasRetryErrors =
      lifecycle.status === "retrying" &&
      this.#retryRevealed &&
      (lifecycle.errors?.length ?? 0) > 0;
    let view: A2UIActivityView = "surface";
    if (this.#operations.length === 0) view = "lifecycle";
    else if (!this.#surfaceReady) view = "handoff";

    const snapshot: A2UIActivitySnapshot = {
      view,
      operations: this.#operations,
      lifecycle,
      debugExposure,
      retryRevealed: this.#retryRevealed,
      label: formatA2UIRetryLabel(lifecycle, this.#retryRevealed),
      progressPhase: getA2UIProgressPhase(lifecycle.progressTokens),
      showDebugDetails:
        debugExposure !== "hidden" && (isFailed || hasRetryErrors),
      debugDetailsOpen: debugExposure === "verbose",
      debugDetailsLabel: isFailed
        ? A2UI_LIFECYCLE_TEXT.failureDetails
        : A2UI_LIFECYCLE_TEXT.retryDetails,
      debugPayload: formatA2UIDebugPayload(
        isFailed
          ? { error: lifecycle.error, attempts: lifecycle.attempts }
          : { attempt: lifecycle.attempt, errors: lifecycle.errors },
      ),
    };
    return snapshot;
  }
}
