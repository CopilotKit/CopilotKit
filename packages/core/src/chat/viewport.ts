/** How the chat scrolls as messages arrive. */
export type ɵAutoScrollMode = "pin-to-bottom" | "pin-to-send" | "none";

const AUTO_SCROLL_MODES: readonly string[] = [
  "pin-to-bottom",
  "pin-to-send",
  "none",
] satisfies readonly ɵAutoScrollMode[];

const isAutoScrollMode = (value: string): value is ɵAutoScrollMode =>
  AUTO_SCROLL_MODES.includes(value);

/**
 * Turns the `autoScroll` prop into a mode. `true` and a missing value mean
 * `"pin-to-bottom"`, `false` means `"none"`, and an unknown string falls back
 * to `"pin-to-bottom"`.
 */
export function ɵnormalizeAutoScroll(
  value: ɵAutoScrollMode | boolean | undefined,
) {
  if (value === false) return "none";
  if (value === undefined || value === true) return "pin-to-bottom";
  return isAutoScrollMode(value) ? value : "pin-to-bottom";
}

/**
 * Media query for the mobile range, where the threads drawer and the chat
 * modal are mutually exclusive.
 */
export const ɵMOBILE_MAX_WIDTH_QUERY = "(max-width: 767px)";

/** `window.matchMedia` for the mobile query, or `null` without a DOM. */
const mobileMediaQuery = () => {
  const hasMatchMedia =
    typeof window !== "undefined" && typeof window.matchMedia === "function";
  return hasMatchMedia ? window.matchMedia(ɵMOBILE_MAX_WIDTH_QUERY) : null;
};

/**
 * Whether the viewport is in the mobile range (`<768px`). `false` during SSR
 * and where `window.matchMedia` is missing (some test runners and webviews).
 */
export function ɵisMobileViewport() {
  return mobileMediaQuery()?.matches ?? false;
}

/**
 * Calls `listener` with {@link ɵisMobileViewport} now and each time the
 * viewport enters or leaves the mobile range. Does nothing without
 * `window.matchMedia`. Returns the unsubscribe function.
 */
export function ɵwatchMobileViewport(listener: (isMobile: boolean) => void) {
  const query = mobileMediaQuery();
  if (query === null) return () => {};
  const update = () => listener(query.matches);
  update();
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}

/**
 * The on-screen keyboard is treated as open once it covers more than this
 * many pixels of the layout viewport.
 */
export const ɵKEYBOARD_OPEN_THRESHOLD_PX = 150;

/** The mobile on-screen keyboard and the height left for the page. */
export interface ɵKeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  /** Height of the visual viewport, the part the keyboard does not cover. */
  availableHeight: number;
  /** Height of the layout viewport (`window.innerHeight`). */
  viewportHeight: number;
}

/**
 * Reads the keyboard state with the Visual Viewport API: the keyboard height
 * is `innerHeight - visualViewport.height`, clamped to 0. Without the API (or
 * during SSR) it reports a closed keyboard and the full window height.
 */
export function ɵreadKeyboardState() {
  if (typeof window === "undefined") return closedKeyboard(0);
  const visualViewport = window.visualViewport;
  if (!visualViewport) return closedKeyboard(window.innerHeight);
  const layoutHeight = window.innerHeight;
  const keyboardHeight = Math.max(0, layoutHeight - visualViewport.height);
  return {
    isKeyboardOpen: keyboardHeight > ɵKEYBOARD_OPEN_THRESHOLD_PX,
    keyboardHeight,
    availableHeight: visualViewport.height,
    viewportHeight: layoutHeight,
  };
}

const closedKeyboard = (height: number): ɵKeyboardState => ({
  isKeyboardOpen: false,
  keyboardHeight: 0,
  availableHeight: height,
  viewportHeight: height,
});

/**
 * The state for the first render, before {@link ɵwatchKeyboardState} reads
 * the visual viewport: a closed keyboard over the full window height (0
 * during SSR).
 */
export function ɵinitialKeyboardState() {
  return closedKeyboard(typeof window === "undefined" ? 0 : window.innerHeight);
}

/**
 * Calls `listener` with {@link ɵreadKeyboardState} now and on each visual
 * viewport resize or scroll. Does nothing during SSR or without the Visual
 * Viewport API. Returns the unsubscribe function.
 */
export function ɵwatchKeyboardState(listener: (state: ɵKeyboardState) => void) {
  if (typeof window === "undefined") return () => {};
  const visualViewport = window.visualViewport;
  if (!visualViewport) return () => {};
  const update = () => listener(ɵreadKeyboardState());
  update();
  visualViewport.addEventListener("resize", update);
  visualViewport.addEventListener("scroll", update);
  return () => {
    visualViewport.removeEventListener("resize", update);
    visualViewport.removeEventListener("scroll", update);
  };
}

/** Input for {@link ɵpinMessageToTop}. */
export interface ɵPinMessageToTopOptions {
  /** The scroll container of the message list. */
  scrollEl: HTMLElement;
  /** The element that holds the messages, inside `scrollEl`. */
  contentEl: HTMLElement;
  /** The spacer after the messages, sized so the message can reach the top. */
  spacerEl: HTMLElement;
  /** The `data-message-id` of the message to pin. */
  messageId: string;
  /** Space between the top of the viewport and the message bubble, in px. */
  topOffset?: number;
}

/** Escapes `id` for a CSS attribute selector, also without `CSS.escape`. */
const escapeSelectorValue = (id: string) =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(id)
    : id.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");

/**
 * Offset of `el` from the top of `stopAt`'s content, including `stopAt`'s
 * scroll. Uses `getBoundingClientRect`, so it works for any CSS position.
 */
const offsetTopWithin = (el: HTMLElement, stopAt: HTMLElement) =>
  el.getBoundingClientRect().top -
  stopAt.getBoundingClientRect().top +
  stopAt.scrollTop;

/**
 * Pins a sent message to the top of the chat: sizes the spacer so the
 * message bubble can scroll to `topOffset` from the viewport top, scrolls
 * there on the next frame, and then shrinks the spacer as the reply below
 * grows, so the bubble stays put.
 *
 * The message element's top padding is scrolled off-screen: the bubble, not
 * its padded box, is pinned. Does nothing when no element in `contentEl` has
 * `data-message-id` equal to `messageId`. Skips the scroll without
 * `requestAnimationFrame` and the spacer updates without `ResizeObserver`.
 *
 * @returns A function that cancels the scroll and stops the spacer updates.
 *
 * @example
 * ```ts
 * const unpin = ɵpinMessageToTop({ scrollEl, contentEl, spacerEl, messageId });
 * // On the next send or on unmount:
 * unpin();
 * ```
 */
export function ɵpinMessageToTop({
  scrollEl,
  contentEl,
  spacerEl,
  messageId,
  topOffset = 16,
}: ɵPinMessageToTopOptions) {
  const targetEl = contentEl.querySelector<HTMLElement>(
    `[data-message-id="${escapeSelectorValue(messageId)}"]`,
  );
  if (!targetEl) return () => {};

  const viewportHeight = scrollEl.clientHeight;
  const userMessageHeight = targetEl.getBoundingClientRect().height;
  const paddingTop = parseFloat(getComputedStyle(targetEl).paddingTop) || 0;
  const bubbleHeight = Math.max(0, userMessageHeight - paddingTop);
  const spacerHeight = Math.max(0, viewportHeight - bubbleHeight - topOffset);
  spacerEl.style.height = `${spacerHeight}px`;

  const frame =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => {
          const targetTop =
            offsetTopWithin(targetEl, scrollEl) + paddingTop - topOffset;
          scrollEl.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
          });
        })
      : null;

  // As the content below the pinned message grows or shrinks, change the
  // spacer by the same amount, so the space below the bubble stays the same.
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const contentHeight = contentEl.getBoundingClientRect().height;
          const consumedBelow =
            contentHeight -
            offsetTopWithin(targetEl, contentEl) -
            userMessageHeight;
          const remaining = Math.max(0, spacerHeight - consumedBelow);
          spacerEl.style.height = `${remaining}px`;
        });
  observer?.observe(contentEl);

  return () => {
    if (frame !== null && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}
