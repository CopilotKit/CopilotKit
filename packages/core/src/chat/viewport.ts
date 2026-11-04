import { ɵSCROLL_BOTTOM_THRESHOLD_PX, ɵisScrolledToBottom } from "./dom";

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
 * It returns `false` when it cancelled a scroll that had not run yet, so the
 * caller can pin the same send again. React's StrictMode tears an effect
 * down before the next frame, so the first run never scrolls.
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
  if (!targetEl) return () => true;

  const viewportHeight = scrollEl.clientHeight;
  const userMessageHeight = targetEl.getBoundingClientRect().height;
  const paddingTop = parseFloat(getComputedStyle(targetEl).paddingTop) || 0;
  const bubbleHeight = Math.max(0, userMessageHeight - paddingTop);
  const spacerHeight = Math.max(0, viewportHeight - bubbleHeight - topOffset);
  spacerEl.style.height = `${spacerHeight}px`;

  let scrolled = false;
  const frame =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => {
          scrolled = true;
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

  return (): boolean => {
    if (frame !== null && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(frame);
    observer?.disconnect();
    return frame === null || scrolled;
  };
}

/** Input for {@link ɵcreateStickToBottom}. */
export interface ɵStickToBottomOptions {
  /** The scroll container of the message list. */
  scrollElement: HTMLElement;
  /**
   * The element that holds the messages. Its size changes and DOM changes
   * keep the list at the bottom. Default: `scrollElement`.
   */
  contentElement?: HTMLElement;
  /**
   * The pixels from the end that still count as the bottom. Default:
   * {@link ɵSCROLL_BOTTOM_THRESHOLD_PX}.
   */
  threshold?: number;
  /**
   * `true` to follow new content while the reader is at the bottom. `false`
   * only tracks the position, for the scroll-to-bottom button. Default:
   * `true`.
   */
  follow?: boolean;
  /** How the first scroll to the bottom moves. Default: `"instant"`. */
  initialBehavior?: ScrollBehavior;
  /** How the scrolls that follow new content move. Default: `"instant"`. */
  followBehavior?: ScrollBehavior;
  /**
   * Runs when {@link ɵStickToBottom.isAtBottom} changes. The value starts as
   * `true`, so the first call is the first `false`.
   */
  onChange?: (isAtBottom: boolean) => void;
}

/**
 * Keeps a message list at its bottom while content arrives, and stops when
 * the reader scrolls up. Scrolling back to the bottom, or a call to
 * {@link ɵStickToBottom.scrollToBottom}, starts it again.
 *
 * Content changes come from a `ResizeObserver` on both elements and a
 * `MutationObserver` on the content. Without them, only scroll events and
 * explicit calls update it.
 *
 * Create it with {@link ɵcreateStickToBottom}.
 */
export class ɵStickToBottom {
  private readonly scrollElement: HTMLElement;
  private readonly contentElement: HTMLElement;
  private readonly threshold: number;
  private readonly followBehavior: ScrollBehavior;
  private readonly onChange: ((isAtBottom: boolean) => void) | undefined;
  private follow: boolean;
  /** The reader has not scrolled away from the bottom. */
  private stuck = true;
  /** A smooth scroll to the bottom is on its way. */
  private smoothPending = false;
  /** `scrollTop` right after the last instant scroll to the bottom. */
  private programmaticTop: number | null = null;
  private lastTop: number;
  private reported = true;
  private frame: number | null = null;
  private readonly observers: { disconnect(): void }[] = [];

  constructor(options: ɵStickToBottomOptions) {
    this.scrollElement = options.scrollElement;
    this.contentElement = options.contentElement ?? options.scrollElement;
    this.threshold = options.threshold ?? ɵSCROLL_BOTTOM_THRESHOLD_PX;
    this.followBehavior = options.followBehavior ?? "instant";
    this.onChange = options.onChange;
    this.follow = options.follow ?? true;
    this.lastTop = this.scrollElement.scrollTop;

    this.scrollElement.addEventListener("scroll", this.update);
    this.scrollElement.addEventListener("scrollend", this.handleScrollEnd);
    this.observeContent();

    if (this.follow) {
      this.scrollToEnd(options.initialBehavior ?? "instant");
      // The first layout can still move after mount (fonts, images, slots).
      if (typeof requestAnimationFrame === "function") {
        this.frame = requestAnimationFrame(() => {
          this.frame = null;
          this.followContent();
        });
      }
    } else {
      this.report();
    }
  }

  /**
   * `true` when the list shows its end, or when it follows new content and
   * is on its way there.
   */
  get isAtBottom() {
    return this.atBottom() || (this.follow && this.stuck);
  }

  /** Turn following new content on or off. */
  setFollow(follow: boolean) {
    if (this.follow === follow) return;
    this.follow = follow;
    this.followContent();
    this.report();
  }

  /**
   * Scroll to the end and follow new content again.
   *
   * @param behavior - Default: `"smooth"`.
   */
  scrollToBottom(behavior: ScrollBehavior = "smooth") {
    this.stuck = true;
    this.scrollToEnd(behavior);
  }

  /**
   * Read the scroll position again, as a scroll event does. Call it when the
   * framework handles scroll events itself.
   */
  readonly update = () => {
    const top = this.scrollElement.scrollTop;
    if (this.atBottom()) {
      this.stuck = true;
      this.smoothPending = false;
    } else if (top === this.programmaticTop) {
      // The scroll event of our own instant scroll. Content grew after it,
      // so the reader did not move away.
    } else if (this.smoothPending && top >= this.lastTop) {
      // A smooth scroll to the bottom is still moving down.
    } else {
      this.stuck = false;
      this.smoothPending = false;
      this.programmaticTop = null;
    }
    this.lastTop = top;
    this.report();
  };

  /** Stop listening and observing. */
  dispose() {
    this.scrollElement.removeEventListener("scroll", this.update);
    this.scrollElement.removeEventListener("scrollend", this.handleScrollEnd);
    for (const observer of this.observers) observer.disconnect();
    this.observers.length = 0;
    if (this.frame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  }

  private readonly handleScrollEnd = () => {
    this.smoothPending = false;
  };

  private readonly followContent = () => {
    if (this.follow && this.stuck) this.scrollToEnd(this.followBehavior);
    else this.report();
  };

  private observeContent() {
    if (typeof ResizeObserver !== "undefined") {
      const resize = new ResizeObserver(this.followContent);
      resize.observe(this.scrollElement);
      if (this.contentElement !== this.scrollElement) {
        resize.observe(this.contentElement);
      }
      this.observers.push(resize);
    }
    if (typeof MutationObserver !== "undefined") {
      const mutation = new MutationObserver(this.followContent);
      mutation.observe(this.contentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      this.observers.push(mutation);
    }
  }

  private scrollToEnd(behavior: ScrollBehavior) {
    const element = this.scrollElement;
    const smooth = behavior === "smooth";
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ top: element.scrollHeight, behavior });
    } else {
      element.scrollTop = element.scrollHeight;
    }
    this.smoothPending = smooth && !this.atBottom();
    this.programmaticTop = smooth ? null : element.scrollTop;
    this.lastTop = element.scrollTop;
    this.report();
  }

  private atBottom() {
    return ɵisScrolledToBottom(this.scrollElement, this.threshold);
  }

  private report() {
    const next = this.isAtBottom;
    if (next === this.reported) return;
    this.reported = next;
    this.onChange?.(next);
  }
}

/**
 * Create the controller that keeps a message list at its bottom.
 *
 * @example
 * ```ts
 * const stick = ɵcreateStickToBottom({
 *   scrollElement,
 *   contentElement,
 *   onChange: (isAtBottom) => (showButton = !isAtBottom),
 * });
 * button.onclick = () => stick.scrollToBottom();
 * stick.dispose(); // on unmount
 * ```
 */
export function ɵcreateStickToBottom(options: ɵStickToBottomOptions) {
  return new ɵStickToBottom(options);
}
