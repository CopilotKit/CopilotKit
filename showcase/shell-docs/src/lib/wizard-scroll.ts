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

export type ScrollOptions = {
  reducedMotion?: boolean;
  durationMs?: number;
  now?: () => number;
  requestFrame?: (cb: (t: number) => void) => void;
  scrollTo?: (top: number) => void;
};

/**
 * Scrolls so that `element` is centred in the viewport, animating the scroll
 * position over `durationMs` with an ease-in-out curve (unless reduced
 * motion is requested, in which case it jumps straight there).
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
  } = options;

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const rawTarget =
    rect.top + window.scrollY - (viewportHeight - rect.height) / 2;
  const target = Math.max(0, rawTarget);

  if (reducedMotion) {
    scrollTo(target);
    return;
  }

  const startTop = window.scrollY;
  const distance = target - startTop;
  const startTime = now();

  function step(currentTime: number) {
    const elapsed = currentTime - startTime;

    if (elapsed >= durationMs) {
      scrollTo(target);
      return;
    }

    const progress = elapsed / durationMs;
    const eased = easeInOutCubic(progress);
    scrollTo(startTop + distance * eased);
    requestFrame(step);
  }

  requestFrame(step);
}
