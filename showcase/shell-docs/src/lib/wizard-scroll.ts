/**
 * Animated-scroll helper for the wizard flow.
 *
 * `scrollIntoView({ behavior: "smooth" })` has a browser-fixed duration that
 * reads as hurried on most devices, and it gives us no way to honour our own
 * timing. That mismatch is the entire reason this module hand-rolls the
 * animation instead of delegating to the browser primitive.
 *
 * Every moving part — the clock, the frame scheduler, and the actual scroll
 * write — is an injectable dependency. That is deliberate: it is what lets
 * the animation be unit-tested deterministically, frame by frame, without a
 * browser or a real requestAnimationFrame loop.
 *
 * The scroll target itself is not always the window: fumadocs' docs shell
 * gives its layout a fixed `100dvh` height and scrolls an inner `<div>`
 * instead, which leaves `window.scrollY` permanently at 0 on that page. So
 * before animating anything, this module walks up from the element looking
 * for the nearest ancestor that is actually the one scrolling — and only
 * falls back to the window when no such ancestor exists.
 */

export const WIZARD_SCROLL_DURATION_MS = 650;

/**
 * Standard cubic ease-in-out: slow start, fast middle, slow end.
 * f(0) = 0, f(1) = 1, f(0.5) = 0.5, and monotonically increasing on [0, 1].
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Guarded read of the reduced-motion media query. Returns false when
 * `window` or `window.matchMedia` isn't available (e.g. during SSR), matching
 * the guard idiom used for the sizzle video in intelligence-overview.tsx.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Walks up from `element`'s parent looking for the ancestor that actually
 * scrolls: computed `overflow-y` of `auto` or `scroll`, and — the part a
 * naive walk gets wrong — `scrollHeight` genuinely exceeding `clientHeight`.
 * A wrapper can be `overflow-y: auto` and still not be the scroller if its
 * content happens to fit; the real page has exactly such wrappers between
 * a step section and the fumadocs container that actually scrolls, so
 * stopping at the first `auto` node would pick the wrong element.
 *
 * `getComputedStyleFn` is injectable so this can be unit-tested with plain
 * fake objects instead of a real DOM/CSSOM — it defaults to the real
 * `window.getComputedStyle` in production.
 */
export function findScrollContainer(
  element: HTMLElement,
  getComputedStyleFn: (
    el: Element,
  ) => Pick<CSSStyleDeclaration, "overflowY"> = (el) =>
    window.getComputedStyle(el),
): HTMLElement | null {
  let node = element.parentElement;

  while (node) {
    const overflowY = getComputedStyleFn(node).overflowY;
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    const overflows = node.scrollHeight > node.clientHeight;

    if (scrolls && overflows) return node;

    node = node.parentElement;
  }

  return null;
}

export type ScrollOptions = {
  reducedMotion?: boolean;
  durationMs?: number;
  now?: () => number;
  requestFrame?: (cb: (t: number) => void) => void;
  scrollTo?: (top: number) => void;
  /**
   * Overrides how the scroll container is chosen. Defaults to
   * `findScrollContainer`. Tests use this to inject a fake container (or
   * `null`, to force the window fallback) without a real layout — jsdom
   * reports zero for every box, so a test relying on real
   * `getBoundingClientRect`/`getComputedStyle` values would assert nothing.
   */
  findScrollContainer?: (element: HTMLElement) => HTMLElement | null;
};

/**
 * Runs the shared ease-in-out animation from `startTop` to `target`,
 * calling `write` on every frame and landing exactly on `target` on the
 * final one. Shared between the container and window paths below so both
 * get identical timing/easing/exact-landing behaviour.
 */
function animateScroll(
  startTop: number,
  target: number,
  durationMs: number,
  now: () => number,
  requestFrame: (cb: (t: number) => void) => void,
  write: (top: number) => void,
): void {
  const distance = target - startTop;
  const startTime = now();

  function step(currentTime: number) {
    const elapsed = currentTime - startTime;

    if (elapsed >= durationMs) {
      write(target);
      return;
    }

    const progress = elapsed / durationMs;
    const eased = easeInOutCubic(progress);
    write(startTop + distance * eased);
    requestFrame(step);
  }

  requestFrame(step);
}

/**
 * Scrolls so that `element` is centred in the viewport, animating the scroll
 * position over `durationMs` with an ease-in-out curve (unless reduced
 * motion is requested, in which case it jumps straight there).
 *
 * The scroll happens against whichever ancestor actually scrolls — see
 * `findScrollContainer` — falling back to the window when none is found.
 */
export function scrollElementIntoCenter(
  element: HTMLElement,
  options: ScrollOptions = {},
): void {
  const {
    reducedMotion = prefersReducedMotion(),
    durationMs = WIZARD_SCROLL_DURATION_MS,
    now = () => performance.now(),
    requestFrame = (cb: (t: number) => void) =>
      window.requestAnimationFrame(cb),
    scrollTo = (top: number) => window.scrollTo(0, top),
    findScrollContainer: resolveContainer = findScrollContainer,
  } = options;

  const container = resolveContainer(element);

  if (container) {
    const rect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const rawTarget =
      container.scrollTop +
      rect.top -
      containerRect.top -
      (container.clientHeight - rect.height) / 2;
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    const target = Math.min(Math.max(0, rawTarget), maxScrollTop);

    if (reducedMotion) {
      container.scrollTop = target;
      return;
    }

    animateScroll(
      container.scrollTop,
      target,
      durationMs,
      now,
      requestFrame,
      (top) => {
        container.scrollTop = top;
      },
    );
    return;
  }

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const rawTarget =
    rect.top + window.scrollY - (viewportHeight - rect.height) / 2;
  const target = Math.max(0, rawTarget);

  if (reducedMotion) {
    scrollTo(target);
    return;
  }

  animateScroll(
    window.scrollY,
    target,
    durationMs,
    now,
    requestFrame,
    scrollTo,
  );
}
