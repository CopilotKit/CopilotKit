/**
 * Auto-grow and compact/expanded layout for the chat input (the composer).
 *
 * The chat input shows the text box in one row with its buttons
 * ("compact"), or on its own row above the buttons ("expanded"). It expands
 * when the text has a line break, wraps, is wider than the compact row, or
 * the viewport is a phone. The text box grows with its text up to
 * `maxRows` rows.
 *
 * This module touches the DOM only inside its functions, never at import
 * time, so it is safe to import during server rendering.
 */

import type { ɵComposerMode } from "./composer";
import { ɵMOBILE_MAX_WIDTH_QUERY } from "./viewport";

/** Where the text box sits in the chat input. */
export type ɵComposerLayout = "compact" | "expanded";

/** The default number of rows the text box grows to before it scrolls. */
export const ɵCOMPOSER_DEFAULT_MAX_ROWS = 5;

/** Sizes of the text box, read from the DOM by {@link ɵmeasureTextarea}. */
export interface ɵTextareaMetrics {
  /** The height of the empty text box, padding included. */
  singleLineHeight: number;
  /** The height of `maxRows` rows, padding included. */
  maxHeight: number;
  paddingLeft: number;
  paddingRight: number;
}

function px(value: string) {
  return parseFloat(value) || 0;
}

function isMobileViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(ɵMOBILE_MAX_WIDTH_QUERY).matches
  );
}

/**
 * Measure the height of one row of the text box and the height of
 * `maxRows` rows, and set the text box's `max-height` to the second. A
 * hidden text box measures `0` and keeps its `max-height`.
 *
 * The text box is emptied for a moment to measure one row. Its text, height,
 * and (when it has focus) its selection are put back.
 *
 * @param textarea - The text box.
 * @param maxRows - The number of rows the text box grows to.
 */
export function ɵmeasureTextarea(
  textarea: HTMLTextAreaElement,
  maxRows: number,
) {
  const previousValue = textarea.value;
  const previousHeight = textarea.style.height;
  const hasFocus = textarea.ownerDocument.activeElement === textarea;
  const { selectionStart, selectionEnd, selectionDirection } = textarea;

  textarea.style.height = "auto";
  const style = textarea.ownerDocument.defaultView!.getComputedStyle(textarea);
  const paddingTop = px(style.paddingTop);
  const paddingBottom = px(style.paddingBottom);

  textarea.value = "";
  const singleLineHeight = textarea.scrollHeight;
  textarea.value = previousValue;
  if (hasFocus) {
    textarea.setSelectionRange(
      selectionStart,
      selectionEnd,
      selectionDirection ?? undefined,
    );
  }

  const contentHeight = singleLineHeight - paddingTop - paddingBottom;
  const maxHeight = contentHeight * maxRows + paddingTop + paddingBottom;

  textarea.style.height = previousHeight;
  // A hidden text box measures 0. Leave its max-height alone then.
  if (singleLineHeight > 0) textarea.style.maxHeight = `${maxHeight}px`;

  return {
    singleLineHeight,
    maxHeight,
    paddingLeft: px(style.paddingLeft),
    paddingRight: px(style.paddingRight),
  } satisfies ɵTextareaMetrics;
}

/**
 * Fit the text box's height to its text, up to `maxHeight`.
 *
 * @param textarea - The text box.
 * @param maxHeight - The tallest the text box gets. `0` means no limit.
 * @returns The height the text needs (`scrollHeight`), which can be more
 *   than `maxHeight`.
 */
export function ɵfitTextareaHeight(
  textarea: HTMLTextAreaElement,
  maxHeight: number,
) {
  if (maxHeight > 0) textarea.style.maxHeight = `${maxHeight}px`;
  textarea.style.height = "auto";
  const scrollHeight = textarea.scrollHeight;
  const height =
    maxHeight > 0 ? Math.min(scrollHeight, maxHeight) : scrollHeight;
  textarea.style.height = `${height}px`;
  return scrollHeight;
}

function resolveFont(style: CSSStyleDeclaration) {
  if (style.font?.trim()) return style.font;
  if (!style.fontSize || !style.fontFamily) return null;
  return (
    `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ` +
    `${style.fontSize}/${style.lineHeight} ${style.fontFamily}`
  );
}

function warnInDevelopment(message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[CopilotChatInput] ${message}`);
  }
}

/**
 * The elements of the chat input. A custom layout can leave out the
 * containers; the text box then still grows, but the layout stays.
 */
export interface ɵComposerElements {
  textarea: HTMLTextAreaElement | null | undefined;
  /** The grid that holds the start buttons, the text box, and the actions. */
  grid: HTMLElement | null | undefined;
  /** The container of the buttons before the text box (the add menu). */
  start: HTMLElement | null | undefined;
  /** The container of the buttons after the text box (voice, send). */
  actions: HTMLElement | null | undefined;
}

export interface ɵComposerAutosizeOptions {
  /**
   * Reads the chat input's elements. It is called on every evaluation, so it
   * can return elements that a framework mounts or replaces later.
   */
  getElements: () => ɵComposerElements;
  /** The rows the text box grows to. Default: {@link ɵCOMPOSER_DEFAULT_MAX_ROWS}. */
  maxRows?: number;
}

/**
 * Sizes the chat input's text box and picks its layout.
 *
 * Create it on mount, call {@link ɵComposerAutosize.evaluate} after each
 * render that changes the text or the mode, and call `dispose()` on unmount.
 * It watches the elements with a `ResizeObserver` and evaluates again, once
 * per animation frame, when the available width changes. Read the layout
 * with `getSnapshot()` and `subscribe()`.
 *
 * Create it with {@link ɵcreateComposerAutosize}.
 */
export class ɵComposerAutosize {
  private layout: ɵComposerLayout = "compact";
  private readonly listeners = new Set<() => void>();
  private readonly getElements: () => ɵComposerElements;
  private maxRows: number;
  private metrics: ɵTextareaMetrics | null = null;
  private compactWidth: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private observed: Element[] = [];
  private containers = new Set<Element>();
  private frame: number | null = null;
  /** The next resize comes from our own layout change. */
  private ignoreResize = false;
  private composingTarget: HTMLTextAreaElement | null = null;
  private isComposing = false;
  private warnedFont = false;
  private warnedCanvas = false;
  private lastValue = "";
  private lastMode: ɵComposerMode = "input";

  constructor(options: ɵComposerAutosizeOptions) {
    this.getElements = options.getElements;
    this.maxRows = options.maxRows ?? ɵCOMPOSER_DEFAULT_MAX_ROWS;
  }

  private readonly onCompositionStart = () => {
    this.isComposing = true;
  };

  private readonly onCompositionEnd = () => {
    this.isComposing = false;
  };

  /** The current layout. Stays the same until the layout changes. */
  getSnapshot = () => this.layout;

  /** Calls `listener` when the layout changes. Returns an unsubscribe. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Change the rows the text box grows to. The text box is measured again
   * at the next evaluation, which this starts.
   */
  setMaxRows(maxRows: number) {
    if (maxRows === this.maxRows) return;
    this.maxRows = maxRows;
    this.metrics = null;
    this.evaluate(this.lastValue, this.lastMode);
  }

  /**
   * Fit the text box to `value` and pick the layout.
   *
   * @param value - The text in the chat input.
   * @param mode - What the chat input shows. Outside `"input"` the layout is
   *   always `"compact"`.
   * @returns The layout, the same as `getSnapshot()` afterwards.
   */
  evaluate(value: string, mode: ɵComposerMode) {
    this.lastValue = value;
    this.lastMode = mode;
    if (mode !== "input") return this.setLayout("compact");

    const elements = this.getElements();
    this.syncObserver(elements);
    this.syncComposition(elements.textarea ?? null);

    const { textarea, grid, start, actions } = elements;
    if (isMobileViewport()) {
      if (textarea) this.fit(textarea);
      return this.setLayout("expanded");
    }
    if (!textarea) return this.layout;
    if (!grid || !start || !actions) {
      // A custom layout has no compact or expanded layout to pick, but the
      // text box still grows with its text.
      this.fit(textarea);
      return this.layout;
    }

    const scrollHeight = this.fit(textarea);
    const singleLineHeight = this.metrics?.singleLineHeight ?? 0;
    const wraps = singleLineHeight > 0 && scrollHeight > singleLineHeight + 1;
    const expand =
      value.includes("\n") ||
      wraps ||
      this.isWiderThanCompactRow(value, textarea, grid, start, actions);
    return this.setLayout(expand ? "expanded" : "compact");
  }

  /**
   * Stop observing the elements. Safe to call twice. A later `evaluate()`
   * observes again, so a framework that mounts the same input twice (React
   * StrictMode) can keep one controller. Subscribers stay subscribed.
   */
  dispose() {
    this.observer?.disconnect();
    this.observer = null;
    this.observed = [];
    if (this.frame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
    this.syncComposition(null);
  }

  private setLayout(next: ɵComposerLayout) {
    if (next === this.layout) return next;
    this.layout = next;
    this.ignoreResize = true;
    for (const listener of this.listeners) listener();
    return next;
  }

  private fit(textarea: HTMLTextAreaElement) {
    // A hidden text box measures 0, so it is measured again once it shows.
    const needsMeasure = !this.metrics || this.metrics.singleLineHeight === 0;
    if (needsMeasure && !this.isComposing) {
      this.metrics = ɵmeasureTextarea(textarea, this.maxRows);
    }
    return ɵfitTextareaHeight(textarea, this.metrics?.maxHeight ?? 0);
  }

  private readCompactWidth(
    grid: HTMLElement,
    start: Element,
    actions: Element,
  ) {
    if (this.compactWidth !== null) return this.compactWidth;
    const style = grid.ownerDocument.defaultView!.getComputedStyle(grid);
    const available =
      grid.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    if (available <= 0) return 0;
    const width = Math.max(
      available -
        start.getBoundingClientRect().width -
        actions.getBoundingClientRect().width -
        px(style.columnGap) * 2,
      0,
    );
    if (width > 0) this.compactWidth = width;
    return width;
  }

  private isWiderThanCompactRow(
    value: string,
    textarea: HTMLTextAreaElement,
    grid: HTMLElement,
    start: Element,
    actions: Element,
  ) {
    const compactWidth = this.readCompactWidth(grid, start, actions);
    const padding =
      (this.metrics?.paddingLeft ?? 0) + (this.metrics?.paddingRight ?? 0);
    const innerWidth = compactWidth - padding;
    if (compactWidth <= 0 || innerWidth <= 0) return false;

    const view = textarea.ownerDocument.defaultView!;
    const font = resolveFont(view.getComputedStyle(textarea));
    if (!font) {
      if (!this.warnedFont) {
        this.warnedFont = true;
        warnInDevelopment(
          "Could not resolve textarea font for layout measurement. " +
            "Text-width-based expansion will be skipped until the next container resize.",
        );
      }
      return false;
    }

    this.canvas ??= textarea.ownerDocument.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (!context) {
      if (!this.warnedCanvas) {
        this.warnedCanvas = true;
        warnInDevelopment(
          "canvas.getContext('2d') returned null. " +
            "Text-width-based expansion will be skipped.",
        );
      }
      return false;
    }

    context.font = font;
    const lines = value.split("\n");
    return lines.some(
      (line) => context.measureText(line || " ").width > innerWidth,
    );
  }

  private syncComposition(textarea: HTMLTextAreaElement | null) {
    if (textarea === this.composingTarget) return;
    const previous = this.composingTarget;
    previous?.removeEventListener("compositionstart", this.onCompositionStart);
    previous?.removeEventListener("compositionend", this.onCompositionEnd);
    this.composingTarget = textarea;
    this.isComposing = false;
    textarea?.addEventListener("compositionstart", this.onCompositionStart);
    textarea?.addEventListener("compositionend", this.onCompositionEnd);
  }

  private syncObserver(elements: ɵComposerElements) {
    if (typeof ResizeObserver === "undefined") return;
    const { textarea, grid, start, actions } = elements;
    const containers = [grid, start, actions].filter(
      (element): element is HTMLElement => !!element,
    );
    const targets = textarea ? [...containers, textarea] : containers;
    const isSame =
      targets.length === this.observed.length &&
      targets.every((target, index) => target === this.observed[index]);
    if (isSame) return;

    this.observer?.disconnect();
    this.observed = targets;
    this.containers = new Set(containers);
    if (targets.length === 0) {
      this.observer = null;
      return;
    }
    this.observer = new ResizeObserver((entries) => {
      const containerResized = entries.some((entry) =>
        this.containers.has(entry.target),
      );
      this.onResize(containerResized);
    });
    for (const target of targets) this.observer.observe(target);
  }

  private onResize(containerResized: boolean) {
    if (this.ignoreResize) {
      // The resize came from our own layout change. The container's size is
      // the same, so the cached width stays valid.
      this.ignoreResize = false;
      return;
    }
    if (containerResized) {
      this.compactWidth = null;
      this.metrics = null;
      this.warnedFont = false;
      this.warnedCanvas = false;
    }
    if (typeof requestAnimationFrame !== "function") {
      this.evaluate(this.lastValue, this.lastMode);
      return;
    }
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.evaluate(this.lastValue, this.lastMode);
    });
  }
}

/**
 * Create the controller that sizes the chat input's text box and picks its
 * layout. See {@link ɵComposerAutosize}.
 *
 * @param options - How to read the elements, and the rows to grow to.
 *
 * @example
 * ```ts
 * const autosize = ɵcreateComposerAutosize({
 *   getElements: () => ({ textarea, grid, start, actions }),
 *   maxRows: 5,
 * });
 * autosize.subscribe(() => render(autosize.getSnapshot()));
 * autosize.evaluate(text, "input"); // after each render
 * autosize.dispose(); // on unmount
 * ```
 */
export function ɵcreateComposerAutosize(options: ɵComposerAutosizeOptions) {
  return new ɵComposerAutosize(options);
}
