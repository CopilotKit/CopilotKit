/**
 * Animation plan for one step swap in the classic stepper.
 *
 * The wizard shows one card at a time. Swapping cards has to do three things
 * at once — fade and slide the outgoing card away, bring the incoming one in
 * from the opposite side, and animate the wrapper's height so a 5-option
 * step being replaced by a 19-option step does not make the page jump. That
 * is fiddly enough to deserve its own tests, and it is pure data: no
 * `document`, no `window`, no `Element`. This module only returns keyframes;
 * the component applies them with the Web Animations API.
 */

export const STEP_TRANSITION_MS = 240;

export type StepDirection = "forward" | "back";

/** One step swap, expressed as keyframes so the caller only applies them. */
export type StepSwapAnimation = {
  readonly outgoing: Keyframe[];
  readonly incoming: Keyframe[];
  readonly wrapper: Keyframe[] | null;
  readonly options: KeyframeAnimationOptions;
};

const SLIDE_DISTANCE_PX = 16;

/**
 * Same ease-in-out character as `easeInOutCubic` in `wizard-scroll.ts` —
 * slow start, fast middle, slow end — expressed as a CSS `cubic-bezier`
 * since this plan is consumed by the Web Animations API, not JS maths.
 */
const STEP_TRANSITION_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";

/**
 * A card measured while `display: none` (e.g. before layout has run)
 * reports a height of 0, and there is no legitimate case where a measured
 * height is negative. Clamping here means a stray negative can never reach
 * `animate()`, where a negative-length keyframe is invalid and throws.
 */
function clampHeight(height: number): number {
  return Math.max(0, height);
}

/**
 * Plans one step swap: how the outgoing card leaves, how the incoming card
 * arrives, and how the wrapper's height should tween between the two cards'
 * measured heights.
 *
 * Forward reads the way paged interfaces already teach readers to expect:
 * the outgoing card exits toward the left (`translateX(-16px)`) and the
 * incoming one arrives from the right (`translateX(16px)` → `0`). Back is
 * the exact mirror. Getting this backwards is a real defect, not a stylistic
 * choice, so it is covered by dedicated tests below.
 *
 * Returns `null` when `reducedMotion` is true — motion that moves content
 * sideways is exactly what that preference exists to suppress, so the
 * caller swaps instantly instead of animating anything.
 */
export function planStepSwap(input: {
  direction: StepDirection;
  fromHeight: number;
  toHeight: number;
  reducedMotion: boolean;
}): StepSwapAnimation | null {
  if (input.reducedMotion) return null;

  const { direction } = input;
  const fromHeight = clampHeight(input.fromHeight);
  const toHeight = clampHeight(input.toHeight);

  const outgoingExitPx =
    direction === "forward" ? -SLIDE_DISTANCE_PX : SLIDE_DISTANCE_PX;
  const incomingEnterPx =
    direction === "forward" ? SLIDE_DISTANCE_PX : -SLIDE_DISTANCE_PX;

  const outgoing: Keyframe[] = [
    { transform: "translateX(0)", opacity: 1 },
    { transform: `translateX(${outgoingExitPx}px)`, opacity: 0 },
  ];

  const incoming: Keyframe[] = [
    { transform: `translateX(${incomingEnterPx}px)`, opacity: 0 },
    { transform: "translateX(0)", opacity: 1 },
  ];

  // Equal heights mean nothing to animate — and animating a zero delta would
  // still pin the wrapper to a fixed pixel height for the duration, which
  // only risks clipping the card if a resize lands mid-transition.
  const wrapper: Keyframe[] | null =
    fromHeight === toHeight
      ? null
      : [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }];

  return {
    outgoing,
    incoming,
    wrapper,
    options: {
      duration: STEP_TRANSITION_MS,
      easing: STEP_TRANSITION_EASING,
    },
  };
}
