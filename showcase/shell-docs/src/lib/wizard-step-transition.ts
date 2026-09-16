/**
 * Animation plan for one step swap in the classic stepper.
 *
 * The wizard shows one card at a time. Swapping cards has to do two things
 * at once — bring the incoming card in from the appropriate side, and
 * animate the wrapper's height so a 5-option step being replaced by a
 * 19-option step does not make the page jump. That is fiddly enough to
 * deserve its own tests, and it is pure data: no `document`, no `window`,
 * no `Element`. This module only returns keyframes; the component applies
 * them with the Web Animations API.
 *
 * There is deliberately no outgoing-card animation. An earlier version
 * cloned the outgoing card, appended the clone to the wrapper, animated it
 * out, and removed it in the animation's `onfinish`. `onfinish` is not a
 * reliable place for required DOM cleanup — it never fires while the tab is
 * hidden (the animation simply never progresses), and it never fires for a
 * cancelled or replaced animation. Three transitions in a hidden tab left
 * two orphaned clones in the wrapper, each one a snapshot of the wrapper's
 * *entire* content at that moment — so a clone contained the previous
 * clone, and the mess compounded rather than merely accumulating. Rendering
 * only the current card and animating just its entrance removes the clone
 * (and the cleanup it required) entirely: there is nothing left to leak.
 */

export const STEP_TRANSITION_MS = 240;

export type StepDirection = "forward" | "back";

/** One step swap, expressed as keyframes so the caller only applies them. */
export type StepSwapAnimation = {
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
 * Plans one step swap: how the incoming card arrives, and how the wrapper's
 * height should tween between the two cards' measured heights.
 *
 * Forward reads the way paged interfaces already teach readers to expect:
 * the incoming card arrives from the right (`translateX(16px)` → `0`). Back
 * is the exact mirror, arriving from the left. Getting this backwards is a
 * real defect, not a stylistic choice, so it is covered by dedicated tests
 * below.
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

  const incomingEnterPx =
    direction === "forward" ? SLIDE_DISTANCE_PX : -SLIDE_DISTANCE_PX;

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
    incoming,
    wrapper,
    // No `fill`: a `"forwards"` fill would hold the wrapper's height (or
    // the incoming card's transform) at its end value once the animation
    // stops, which is only safe if something later releases that pin. This
    // component sets no inline style to release, on purpose (see the
    // `runStepSwapAnimation` comment in `setup-wizard.tsx`), so a
    // transition that never finishes — a hidden tab, a cancelled or
    // replaced animation — must leave the wrapper at its natural size
    // instead of pinned to a stale value.
    options: {
      duration: STEP_TRANSITION_MS,
      easing: STEP_TRANSITION_EASING,
    },
  };
}
