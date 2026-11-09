/**
 * DOM helpers that the chat views of React, Vue, and Angular share: the
 * docked sidebar's page margins, popup dismissal and exit animation, the
 * default popup and sidebar sizes, the lightbox's view-transition morph and
 * focus handling, document previews, the scroll-to-bottom check, and
 * element size watchers.
 *
 * Nothing here touches the DOM at import time, so it is safe to import
 * during server rendering.
 */

import type { Attachment } from "@copilotkit/shared";
import { ɵMOBILE_MAX_WIDTH_QUERY } from "./viewport";

// ---------------------------------------------------------------------------
// CSS dimensions
// ---------------------------------------------------------------------------

/**
 * Turn a width or height prop into a CSS value.
 *
 * @param value - A number of pixels, or a CSS length such as `"30rem"`.
 * @param fallback - The pixels to use when `value` is missing, not finite,
 *   or an empty string.
 *
 * @example
 * ```ts
 * ɵdimensionToCss(420, 480); // "420px"
 * ɵdimensionToCss(" 30rem ", 480); // "30rem"
 * ɵdimensionToCss(undefined, 480); // "480px"
 * ```
 */
export function ɵdimensionToCss(
  value: number | string | undefined,
  fallback: number,
) {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return `${fallback}px`;
}

// ---------------------------------------------------------------------------
// Docked sidebar
// ---------------------------------------------------------------------------

/** The side of the page a sidebar docks to. */
export type ɵSidebarPosition = "left" | "right";

/** Where the docked sidebar sits and how wide it is. */
export interface ɵDockedSidebarPlacement {
  position: ɵSidebarPosition;
  /** A CSS width, for example from {@link ɵdimensionToCss}. */
  width: string;
}

/** Options for one change of the page margins. */
export interface ɵDockedSidebarTransition {
  /** Animate the margin for this many ms. Leave out to change it at once. */
  transitionMs?: number;
}

const ONLY_ONE_DOCKED_SIDEBAR =
  "[CopilotKit] Only one docked CopilotSidebar may be open per document.";

/**
 * Gives one docked sidebar at a time the page's inline margin on its side,
 * and puts back the margins the page had before when it lets go.
 *
 * Get the registry of a document with {@link ɵdockedSidebarRegistryFor}.
 */
export class ɵDockedSidebarRegistry {
  private owner: symbol | undefined;
  private original = { start: "", end: "", transition: "" };
  private restoreTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly warned = new Set<symbol>();

  constructor(private readonly document: Document) {}

  /**
   * Take the page margins for `owner`.
   *
   * @returns `true` when `owner` now has them. `false`, with a warning, when
   *   another sidebar has them.
   */
  acquire(owner: symbol) {
    if (this.owner === owner) return true;
    if (this.owner !== undefined) {
      if (!this.warned.has(owner)) {
        this.warned.add(owner);
        console.warn(ONLY_ONE_DOCKED_SIDEBAR);
      }
      return false;
    }
    const style = this.document.body.style;
    // While a release still animates, the transition on the page is ours,
    // so keep the page's own one from before.
    const transition =
      this.restoreTimer === undefined
        ? style.transition
        : this.original.transition;
    this.original = {
      start: style.marginInlineStart,
      end: style.marginInlineEnd,
      transition,
    };
    this.cancelRestore();
    this.owner = owner;
    return true;
  }

  /** Set the margin on the sidebar's side. Does nothing unless `owner` has it. */
  update(
    owner: symbol,
    placement: ɵDockedSidebarPlacement,
    options: ɵDockedSidebarTransition = {},
  ) {
    if (this.owner !== owner) return;
    const style = this.document.body.style;
    this.applyTransition(options.transitionMs);
    style.marginInlineStart =
      placement.position === "left" ? placement.width : this.original.start;
    style.marginInlineEnd =
      placement.position === "right" ? placement.width : this.original.end;
  }

  /**
   * Put back the page's own margins and let go. Does nothing unless `owner`
   * has the margins.
   */
  release(owner: symbol, options: ɵDockedSidebarTransition = {}) {
    this.warned.delete(owner);
    if (this.owner !== owner) return;
    const style = this.document.body.style;
    this.applyTransition(options.transitionMs);
    style.marginInlineStart = this.original.start;
    style.marginInlineEnd = this.original.end;
    this.owner = undefined;
    if (options.transitionMs === undefined) return;
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = undefined;
      if (this.owner === undefined) style.transition = this.original.transition;
    }, options.transitionMs);
  }

  private applyTransition(transitionMs: number | undefined) {
    const style = this.document.body.style;
    this.cancelRestore();
    style.transition =
      transitionMs === undefined
        ? this.original.transition
        : `margin-inline-start ${transitionMs}ms ease, margin-inline-end ${transitionMs}ms ease`;
  }

  private cancelRestore() {
    if (this.restoreTimer === undefined) return;
    clearTimeout(this.restoreTimer);
    this.restoreTimer = undefined;
  }
}

const registries = new WeakMap<Document, ɵDockedSidebarRegistry>();

/** The one {@link ɵDockedSidebarRegistry} of `document`. */
export function ɵdockedSidebarRegistryFor(document: Document) {
  let registry = registries.get(document);
  if (!registry) {
    registry = new ɵDockedSidebarRegistry(document);
    registries.set(document, registry);
  }
  return registry;
}

/** What {@link ɵDockedSidebar.set} reads. */
export interface ɵDockedSidebarState extends ɵDockedSidebarPlacement {
  open: boolean;
}

/**
 * Makes room on the page for an open sidebar, on desktop viewports only
 * (wider than 767px). It follows viewport changes, animates every change
 * after the first, and gives the page its margins back on `dispose()`.
 *
 * Create it with {@link ɵcreateDockedSidebar}.
 */
export class ɵDockedSidebar {
  private readonly owner = Symbol("copilot-sidebar");
  private readonly registry: ɵDockedSidebarRegistry;
  private readonly media: MediaQueryList | undefined;
  private state: ɵDockedSidebarState | undefined;
  private owns = false;
  private hasApplied = false;

  constructor(
    document: Document,
    private readonly transitionMs: number,
  ) {
    this.registry = ɵdockedSidebarRegistryFor(document);
    this.media = document.defaultView?.matchMedia?.(ɵMOBILE_MAX_WIDTH_QUERY);
    this.media?.addEventListener("change", this.apply);
  }

  /**
   * `true` while this sidebar has the page margin. `false` when it is closed,
   * on a mobile viewport, or when another docked sidebar has the margin.
   */
  get isDocked() {
    return this.owns;
  }

  /** Apply the sidebar's open state, side, and width. */
  set(state: ɵDockedSidebarState) {
    this.state = state;
    this.apply();
  }

  /** Give the margins back at once and stop following the viewport. */
  dispose() {
    this.media?.removeEventListener("change", this.apply);
    this.registry.release(this.owner);
    this.owns = false;
  }

  private readonly apply = () => {
    const state = this.state;
    if (!state) return;
    const transition = this.hasApplied
      ? { transitionMs: this.transitionMs }
      : {};
    this.hasApplied = true;
    const isDocked = state.open && !this.media?.matches;

    if (!isDocked) {
      if (this.owns) this.registry.release(this.owner, transition);
      this.owns = false;
      return;
    }
    this.owns = this.owns || this.registry.acquire(this.owner);
    if (this.owns) this.registry.update(this.owner, state, transition);
  };
}

/**
 * Create the controller that reserves the page margin for a docked sidebar.
 *
 * @param document - The page.
 * @param options - `transitionMs`: how long margin changes animate.
 *
 * @example
 * ```ts
 * const dock = ɵcreateDockedSidebar(document, { transitionMs: 260 });
 * dock.set({ open: true, position: "right", width: "480px" });
 * dock.dispose(); // on unmount
 * ```
 */
export function ɵcreateDockedSidebar(
  document: Document,
  options: { transitionMs: number },
) {
  return new ɵDockedSidebar(document, options.transitionMs);
}

// ---------------------------------------------------------------------------
// Popup dismissal
// ---------------------------------------------------------------------------

/** How long the popup's open animation runs, in ms. */
export const ɵPOPUP_ANIMATION_MS = 200;

/** The popup's width when the `width` prop is missing, in px. */
export const ɵPOPUP_DEFAULT_WIDTH = 420;

/** The popup's height when the `height` prop is missing, in px. */
export const ɵPOPUP_DEFAULT_HEIGHT = 560;

/** The sidebar's width when the `width` prop is missing, in px. */
export const ɵSIDEBAR_DEFAULT_WIDTH = 480;

/** How long the docked sidebar's page margin animates, in ms. */
export const ɵSIDEBAR_TRANSITION_MS = 260;

/** Whether a closing panel is still in the DOM. */
export interface ɵExitPresenceState {
  /** Render the panel. */
  isRendered: boolean;
  /** The panel is closed but still plays its exit animation. */
  isClosing: boolean;
}

/**
 * Keeps a closed panel in the DOM for its exit animation, then removes it.
 * Opening again during the animation cancels the removal.
 *
 * Create it with {@link ɵcreateExitPresence}. Each change makes a new state
 * object, so `getState` works with React's `useSyncExternalStore`.
 */
export class ɵExitPresence {
  private state: ɵExitPresenceState;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(state: ɵExitPresenceState) => void>();

  constructor(
    open: boolean,
    private readonly durationMs: number,
  ) {
    this.state = { isRendered: open, isClosing: false };
  }

  /** The current state. */
  readonly getState = () => this.state;

  /**
   * Call `listener` on each change.
   *
   * @returns The unsubscribe function.
   */
  readonly subscribe = (listener: (state: ɵExitPresenceState) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Apply the panel's open state. */
  setOpen(open: boolean) {
    if (open) {
      this.clearTimer();
      this.set({ isRendered: true, isClosing: false });
      return;
    }
    if (!this.state.isRendered || this.timer !== undefined) return;
    this.set({ isRendered: true, isClosing: true });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.set({ isRendered: false, isClosing: false });
    }, this.durationMs);
  }

  /** Cancel a pending removal. */
  dispose() {
    this.clearTimer();
  }

  private set(next: ɵExitPresenceState) {
    const current = this.state;
    if (
      current.isRendered === next.isRendered &&
      current.isClosing === next.isClosing
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private clearTimer() {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Create the exit-animation state of a popup or another panel.
 *
 * @param open - Whether the panel starts open.
 * @param options - `durationMs`: how long the exit animation runs. Default:
 *   {@link ɵPOPUP_ANIMATION_MS}.
 *
 * @example
 * ```ts
 * const presence = ɵcreateExitPresence(isOpen);
 * presence.subscribe(({ isRendered, isClosing }) => render(isRendered, isClosing));
 * presence.setOpen(false); // renders until the animation ends
 * presence.dispose(); // on unmount
 * ```
 */
export function ɵcreateExitPresence(
  open: boolean,
  options: { durationMs?: number } = {},
) {
  return new ɵExitPresence(open, options.durationMs ?? ɵPOPUP_ANIMATION_MS);
}

export interface ɵPopupDismissOptions {
  /** The popup's panel. Reads it at event time. */
  getContainer: () => HTMLElement | null | undefined;
  /** Close the popup. */
  onDismiss: () => void;
  /** `true` to also close on a pointer down outside the popup. */
  clickOutsideToClose: boolean;
}

/**
 * Close an open popup on Escape and, when asked, on a pointer down outside
 * it, and move focus into it once its open animation ends.
 *
 * A pointer down on the chat toggle button, or in a chat popover (which
 * renders in a portal, outside the panel), does not close the popup. Focus
 * moves to the panel only when nothing inside it has focus yet.
 *
 * Call it when the popup opens, and call the returned function when it
 * closes or unmounts.
 *
 * @param options - The panel, the close callback, and whether a click
 *   outside closes.
 */
export function ɵbindPopupDismiss(options: ɵPopupDismissOptions) {
  if (typeof window === "undefined") return () => {};

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    options.onDismiss();
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (options.getContainer()?.contains(target)) return;
    const element = target instanceof Element ? target : target.parentElement;
    const isExempt = element?.closest(
      "[data-slot='chat-toggle-button'], [data-copilotkit-popover]",
    );
    if (isExempt) return;
    options.onDismiss();
  };

  const focusTimer = setTimeout(() => {
    const container = options.getContainer();
    if (
      container &&
      !container.contains(container.ownerDocument.activeElement)
    ) {
      container.focus({ preventScroll: true });
    }
  }, ɵPOPUP_ANIMATION_MS);

  window.addEventListener("keydown", handleKeyDown);
  if (options.clickOutsideToClose) {
    document.addEventListener("pointerdown", handlePointerDown);
  }

  return () => {
    clearTimeout(focusTimer);
    window.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("pointerdown", handlePointerDown);
  };
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

/**
 * Open or close a lightbox with the View Transition API, so the thumbnail
 * morphs into the preview and back.
 *
 * `view-transition-name` must be on one element at a time: on the
 * thumbnail before the change and on the preview after it. Bind `name` to
 * the preview element. Without the API, or without a thumbnail, `apply`
 * runs with no animation.
 *
 * @param thumbnail - The element the preview grows from.
 * @param name - A `view-transition-name`, unique on the page.
 * @param apply - Renders the change. It must finish the DOM update before
 *   it returns or resolves (React: `flushSync`; Vue: `await nextTick()`).
 * @param direction - `"open"` or `"close"`.
 */
export function ɵmorphViewTransition(
  thumbnail: HTMLElement | null | undefined,
  name: string,
  apply: () => void | Promise<void>,
  direction: "open" | "close",
) {
  const doc = typeof document === "undefined" ? undefined : document;
  const canMorph =
    !!thumbnail && typeof doc?.startViewTransition === "function";
  if (!canMorph || !thumbnail || !doc) {
    void apply();
    return;
  }

  if (direction === "open") {
    thumbnail.style.viewTransitionName = name;
    doc.startViewTransition(async () => {
      thumbnail.style.viewTransitionName = "";
      await apply();
    });
    return;
  }

  const transition = doc.startViewTransition(async () => {
    await apply();
    thumbnail.style.viewTransitionName = name;
  });
  const clear = () => {
    thumbnail.style.viewTransitionName = "";
  };
  transition.finished.then(clear, clear);
}

// Elements that can take focus.
const FOCUSABLE_ELEMENTS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "audio[controls]",
  "video[controls]",
  "iframe",
  "[tabindex]",
];

const FOCUSABLE = FOCUSABLE_ELEMENTS.map((selector) =>
  selector === "[tabindex]" ? '[tabindex]:not([tabindex="-1"])' : selector,
).join(", ");

/**
 * Elements Tab stops at: the focusable ones without `tabindex="-1"`. Radix
 * focus guards, which only pass focus on, are left out.
 */
export const ɵTAB_STOP_SELECTOR = FOCUSABLE_ELEMENTS.map(
  (selector) =>
    `${selector}:not([tabindex="-1"]):not([data-radix-focus-guard])`,
).join(", ");

/**
 * Approximately the element Tab reaches after `element`, in document order.
 * Elements inside `skip` (for example a popover in a portal) and inside
 * `[hidden]` or `[inert]` are passed over.
 *
 * @returns The next tab stop, or `null` when there is none.
 */
export function ɵnextTabStop(element: Element, skip: Element | null) {
  const all = Array.from(
    element.ownerDocument.querySelectorAll<HTMLElement>(ɵTAB_STOP_SELECTOR),
  ).filter(
    (candidate) =>
      candidate === element ||
      (!skip?.contains(candidate) && !candidate.closest("[hidden], [inert]")),
  );
  const index = all.findIndex((candidate) => candidate === element);
  return index === -1 ? null : (all[index + 1] ?? null);
}

/**
 * Whether focus on `element` came from the keyboard. A pointer click also
 * focuses buttons, and this tells the two apart.
 */
export function ɵisFocusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    // Browsers without `:focus-visible` throw on the selector.
    return false;
  }
}

export interface ɵDialogFocusOptions {
  /** Where focus goes on open. Default: the first focusable element. */
  initialFocus?: HTMLElement | null;
  /** Where focus goes on close. Default: the element focused on open. */
  returnFocusTo?: HTMLElement | null;
}

/**
 * Make `root` behave as a modal dialog for keyboard users: focus moves into
 * it, Tab and Shift+Tab wrap inside it, and focus goes back to the opener
 * when the returned function runs.
 *
 * @param root - The dialog element.
 * @param options - Where focus goes on open and on close.
 * @returns A function that removes the trap and returns focus.
 */
export function ɵbindDialogFocus(
  root: HTMLElement,
  options: ɵDialogFocusOptions = {},
) {
  const doc = root.ownerDocument;
  const active = doc.activeElement;
  const opener = active instanceof HTMLElement ? active : null;
  const focusables = () =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const elements = focusables();
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const current = doc.activeElement;
    const isOutside = !root.contains(current);
    if (event.shiftKey && (current === first || isOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || isOutside)) {
      event.preventDefault();
      first.focus();
    }
  };

  root.addEventListener("keydown", handleKeyDown);
  (options.initialFocus ?? focusables()[0])?.focus();

  return () => {
    root.removeEventListener("keydown", handleKeyDown);
    const target = options.returnFocusTo ?? opener;
    if (target?.isConnected) target.focus();
  };
}

// ---------------------------------------------------------------------------
// Document preview
// ---------------------------------------------------------------------------

type AttachmentSource = Attachment["source"];

/**
 * Which in-browser preview a document gets.
 *
 * @param mimeType - The document's MIME type.
 * @returns `"pdf"`, `"text"` (for `text/*`), or `null` when the browser
 *   cannot preview it.
 */
export function ɵcanPreviewDocument(mimeType: string | undefined) {
  if (!mimeType) return null;
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.startsWith("text/")) return "text";
  return null;
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * A URL a browser can show in an `<iframe>` for an attachment's source.
 *
 * Browsers block `data:` URLs for PDFs in frames, so base64 data becomes a
 * `blob:` URL. Call `revoke()` when the preview closes.
 *
 * @param source - The attachment's source.
 * @returns `{ url, revoke }`, or `null` when the data is not valid base64.
 */
export function ɵcreateObjectUrlFromSource(source: AttachmentSource) {
  if (source.type === "url") return { url: source.value, revoke: () => {} };
  try {
    const blob = new Blob([decodeBase64(source.value)], {
      type: source.mimeType || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch (error) {
    console.error("[CopilotKit] Failed to decode attachment data:", error);
    return null;
  }
}

/**
 * The text of a text attachment, for a `<pre>` preview.
 *
 * @param source - The attachment's source.
 * @returns The base64 data decoded as UTF-8, the raw value when it is not
 *   valid base64, or `null` for a URL source (show it in a frame instead).
 */
export function ɵdecodeTextSource(source: AttachmentSource) {
  if (source.type !== "data") return null;
  try {
    return new TextDecoder().decode(decodeBase64(source.value));
  } catch {
    return source.value;
  }
}

// ---------------------------------------------------------------------------
// Scroll to bottom
// ---------------------------------------------------------------------------

/** How close to the end, in pixels, still counts as scrolled to the bottom. */
export const ɵSCROLL_BOTTOM_THRESHOLD_PX = 12;

/**
 * Whether a scroll container shows the end of its content.
 *
 * @param element - The scroll container.
 * @param threshold - The pixels from the end that still count. Default:
 *   {@link ɵSCROLL_BOTTOM_THRESHOLD_PX}.
 */
export function ɵisScrolledToBottom(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = ɵSCROLL_BOTTOM_THRESHOLD_PX,
) {
  const distance =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance <= threshold;
}

/**
 * Whether a scroll container shows the end of `content`, an element inside
 * it. Use it when empty space follows the messages, such as the
 * `pin-to-send` spacer: scrolling into that space shows no more messages.
 *
 * @param element - The scroll container.
 * @param content - The element that holds the messages.
 * @param threshold - The pixels of `content` below the viewport that still
 *   count. Default: {@link ɵSCROLL_BOTTOM_THRESHOLD_PX}.
 */
export function ɵisContentScrolledToBottom(
  element: Element,
  content: Element,
  threshold = ɵSCROLL_BOTTOM_THRESHOLD_PX,
) {
  const hiddenBelow =
    content.getBoundingClientRect().bottom -
    element.getBoundingClientRect().bottom;
  return hiddenBelow <= threshold;
}

// ---------------------------------------------------------------------------
// Element size
// ---------------------------------------------------------------------------

/** How long an element counts as resizing after its last size change, in ms. */
export const ɵRESIZE_SETTLE_MS = 250;

/** What {@link ɵwatchElementHeight} reports. */
export interface ɵElementHeightState {
  /** The content-box height, in px. */
  height: number;
  /** The height changed less than `settleMs` ago. */
  isResizing: boolean;
}

/**
 * Report an element's height now and on each change. `isResizing` is `true`
 * from a change until the height stays the same for `settleMs`, so callers
 * can hide UI, such as the scroll-to-bottom button, while a layout moves.
 *
 * The first call reads `offsetHeight`. Later calls read the
 * `ResizeObserver` content box. Without `ResizeObserver`, only the first
 * call happens.
 *
 * @param element - The element to measure.
 * @param listener - Gets the height and the resizing state.
 * @param options - `settleMs`: default {@link ɵRESIZE_SETTLE_MS}.
 * @returns A function that stops the watch.
 */
export function ɵwatchElementHeight(
  element: HTMLElement,
  listener: (state: ɵElementHeightState) => void,
  options: { settleMs?: number } = {},
) {
  const settleMs = options.settleMs ?? ɵRESIZE_SETTLE_MS;
  let height = element.offsetHeight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  listener({ height, isResizing: false });
  if (typeof ResizeObserver === "undefined") return () => {};

  const observer = new ResizeObserver((entries) => {
    const next = entries[entries.length - 1]?.contentRect.height;
    if (next === undefined || next === height) return;
    height = next;
    if (timer !== undefined) clearTimeout(timer);
    if (settleMs <= 0) {
      listener({ height, isResizing: false });
      return;
    }
    listener({ height, isResizing: true });
    timer = setTimeout(() => {
      timer = undefined;
      listener({ height, isResizing: false });
    }, settleMs);
  });
  observer.observe(element);

  return () => {
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * Report an element's border-box width now and on each change, skipping
 * zero widths (a hidden element). Uses `ResizeObserver`, or the window's
 * `resize` event without it.
 *
 * @param element - The element to measure, for example a sidebar.
 * @param listener - Gets the width in px.
 * @returns A function that stops the watch.
 */
export function ɵwatchElementWidth(
  element: HTMLElement,
  listener: (width: number) => void,
) {
  const update = () => {
    const width = element.getBoundingClientRect().width;
    if (width > 0) listener(width);
  };
  update();
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }
  const view = element.ownerDocument.defaultView;
  if (!view) return () => {};
  view.addEventListener("resize", update);
  return () => view.removeEventListener("resize", update);
}
