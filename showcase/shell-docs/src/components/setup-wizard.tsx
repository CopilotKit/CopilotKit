"use client";

// <SetupWizard> — the client component that owns the homepage setup wizard's
// state and drives the presentational parts in `./docs-map-parts`,
// `./wizard-stepper-parts` and `./wizard-review`.
//
// Classic one-card-at-a-time stepper: whether the reader already has a
// project, frontend, agent backend, features, copy prompt. This component
// owns exactly three pieces of bookkeeping: the four selections, the
// currently displayed step (`current`), and the furthest step the reader
// has reached (`furthest`, 1-based, never decreases). The progress rail's
// disabled treatment for steps beyond `furthest` is `wizard-stepper-parts`'
// job; this file only ever hands it the number. On mount, `furthest` is
// seeded from which answers are actually present in the restored URL
// (`furthestFromAnswers`), not from `landingStep` alone — `landingStep`
// stops at the first unanswered step, so a restored
// `?project=yes&frontend=vue&features=gen-ui` lands on step 3, but step 4's
// answer is already sitting in state and the rail must let the reader jump
// straight to it.
//
// `handleBack` and `handleJump` read `current`/`furthest` through
// `currentRef`/`furthestRef` rather than closing over the state values —
// see the comment on those refs for why.
//
// Steps 1, 2 and 3 each have a required choice, and Continue is never
// disabled — `WizardNav`'s primary button always takes the click. When the
// required choice is still missing, `handleContinueProject`/
// `handleContinueFrontend`/`handleContinueBackend` below catch the click
// instead of calling `goTo`: they set `hint` to a short instruction
// (`WizardNav` renders it in a reserved, always-present row so it cannot
// move the footer) and move focus into that step's option list via
// `projectOptionsRef`/`frontendOptionsRef`/`backendOptionsRef`, so a
// keyboard user lands where the work is instead of stuck on a button that
// just did nothing. `hint` clears the moment the choice is made (the
// `ChoiceGrid`/`PickGrid` `onSelect` handlers below clear it directly) and
// on every navigation (`goTo` clears it too), so it never lingers once it
// is no longer true and never reappears on a plain step change.
//
// Changing an earlier answer must never clear a later one: going back to
// step 2 and picking a different frontend leaves the backend and the
// features exactly as they were. There is simply no code path here that
// resets `backendId` or `featureIds` from the frontend picker (or any other
// cross-step reset) — that absence is the guarantee, not something asserted
// via extra bookkeeping, so a mutation that adds such a reset is meant to be
// caught by the "changing an earlier answer" test below, not silently
// absorbed.
//
// This component reads no data of its own: no `@/lib/registry`, no
// `frontendPicks()` / `agentPicks()`. Those pull in the ~646 KB registry,
// and importing them here would ship that registry to the browser — this is
// the only client module in the wizard, so anything it imports crosses the
// boundary. The server shell (`./docs-setup-wizard`) reads the registry and
// passes the three prop arrays down.

import React from "react";
import Link from "next/link";
import { Copy, FolderCode, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { CapabilityGrid, PickGrid } from "@/components/docs-map-parts";
import { WizardReview } from "@/components/wizard-review";
import type { MapCapability, MapPick } from "@/lib/homepage-map";
import {
  parseWizardUrlState,
  serializeWizardUrlState,
} from "@/lib/wizard-url-state";
import type {
  WizardUrlAllowlists,
  WizardUrlState,
} from "@/lib/wizard-url-state";
import { prefersReducedMotion } from "@/lib/wizard-scroll";
import { useIsomorphicLayoutEffect } from "@/lib/isomorphic-layout-effect";
import { planStepSwap } from "@/lib/wizard-step-transition";
import type {
  StepDirection,
  StepSwapAnimation,
} from "@/lib/wizard-step-transition";
import { composeWizardOnboardingPrompt } from "@/lib/wizard-onboarding-prompt";
import {
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";
import {
  ChoiceGrid,
  QUIET_BUTTON_CLASS,
  WizardCard,
  WizardNav,
  WizardProgress,
} from "@/components/wizard-stepper-parts";
import type {
  ChoiceOption,
  StepperStep,
} from "@/components/wizard-stepper-parts";

export interface SetupWizardProps {
  frontends: readonly MapPick[];
  capabilities: readonly MapCapability[];
  backends: readonly MapPick[];
}

type CopyState = "idle" | "copied" | "error";

const TOTAL_STEPS = 5;

const STEPPER_STEPS: readonly StepperStep[] = [
  { n: 1, label: "Project" },
  { n: 2, label: "Frontend" },
  { n: 3, label: "Backend" },
  { n: 4, label: "Features" },
  { n: 5, label: "Prompt" },
];

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy prompt",
  copied: "Copied",
  error: "Copy blocked",
};

/** The two answers to step 1's "Do you already have a project?" — also the
 *  allow-list `parseWizardUrlState` validates a restored `project` query
 *  value against, so the ids a reader can pick and the ids a URL is allowed
 *  to carry can never drift apart. */
const PROJECT_ANSWER_IDS = ["yes", "no"] as const;

// Named imports into an explicit record, never `import * as icons` with a
// runtime index — see `docs-map-parts.tsx`'s `CAPABILITY_ICONS` comment for
// the bundle-size regression that guards against (605 KB minified for a
// namespace import indexed at runtime, vs. 6 KB for named imports; a
// namespace object forces the bundler to retain every lucide export and
// blocks Next's optimizePackageImports from rewriting it).
//
// Neither icon is a checkmark: a checkmark already means *selected*
// elsewhere in this wizard (`CapabilityGrid`'s toggle tiles), and using one
// here for the option's own meaning would collide with that. Nor is it a
// check/cross pair, which reads as right and wrong — starting fresh is not
// a wrong answer. `FolderCode` stands for the existing codebase "Yes" adds
// CopilotKit to; `Sparkles` stands for the fresh start "No" begins instead.
const PROJECT_OPTION_ICONS: Record<
  (typeof PROJECT_ANSWER_IDS)[number],
  LucideIcon
> = {
  yes: FolderCode,
  no: Sparkles,
};

const PROJECT_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "yes",
    label: "Yes",
    description: "Add CopilotKit to what you have",
    icon: PROJECT_OPTION_ICONS.yes,
  },
  {
    id: "no",
    label: "No",
    description: "Start from scratch",
    icon: PROJECT_OPTION_ICONS.no,
  },
];

/**
 * The step a restored URL — or a fresh mount with no query at all — should
 * land on: the first step whose answer is still missing, in the step order
 * (project, frontend, backend, features, prompt), or step 5 once every
 * answer, including the optional features step, has something in it. A
 * shared link should open where there is something left to do, not back at
 * step 1.
 */
function landingStep(restored: WizardUrlState): number {
  if (!restored.project) return 1;
  if (!restored.frontend) return 2;
  if (!restored.backend) return 3;
  if (restored.features.length === 0) return 4;
  return 5;
}

/**
 * The value to initialize `furthest` to when restoring a URL (or a fresh
 * mount): the highest step number that has an actual answer sitting in
 * `restored`, folded with `landing` itself since the reader is standing
 * there regardless of whether anything is answered yet — the rail must
 * never disable the step already on screen.
 *
 * Deliberately independent of `landingStep`: that function walks the steps
 * in order and stops at the first *unanswered* one, so a restored
 * `?project=yes&frontend=vue&features=gen-ui` (no backend) lands on step 3
 * even though step 4 already has an answer sitting in `features`.
 * `furthest` has a different job — it gates which steps the progress rail
 * lets the reader jump to — so it has to credit every answer independently
 * instead of stopping at the first gap. Without this, that same URL would
 * disable step 4 on the rail despite its answer already being in state,
 * which is exactly the bug this fixes.
 */
function furthestFromAnswers(
  restored: WizardUrlState,
  landing: number,
): number {
  let furthest = landing;
  if (restored.project) furthest = Math.max(furthest, 1);
  if (restored.frontend) furthest = Math.max(furthest, 2);
  if (restored.backend) furthest = Math.max(furthest, 3);
  if (restored.features.length > 0) furthest = Math.max(furthest, 4);
  return furthest;
}

/** Moves focus to the first option button inside a step's `PickGrid`, given
 *  the ref that step's body attaches to its wrapping `<div>` — the target
 *  for a Continue click blocked by a missing required choice, so a keyboard
 *  user lands where the work is instead of on a button that just did
 *  nothing. Module-level rather than a closure inside `SetupWizard`: it
 *  captures nothing from that component's scope. */
function focusFirstOption(ref: React.RefObject<HTMLDivElement | null>): void {
  ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
}

/**
 * What `goTo` records before handing control back to React: the direction
 * of travel and the wrapper's height right before the swap, so the layout
 * effect below can tween from it once the incoming card has committed.
 */
type PendingTransition = {
  readonly direction: StepDirection;
  readonly fromHeight: number;
};

/**
 * Applies one planned step swap to the DOM: the (already-committed)
 * incoming card fades/slides in, and the wrapper's height tweens between the
 * two measured heights. Isolated in its own function so the component's
 * effect only has to wire up refs, and so a test can assert *that* a swap
 * was applied — via the `Element.prototype.animate` stub — without reaching
 * into WAAPI internals jsdom does not implement.
 *
 * Only the current card is ever rendered — there is no outgoing card to
 * animate, and therefore no clone to append and no cleanup to schedule. An
 * earlier version cloned the outgoing card into the wrapper and removed the
 * clone in the animation's `onfinish`, but `onfinish` never fires while the
 * tab is hidden or for a cancelled/replaced animation, so those clones piled
 * up in the DOM. Sets no inline style on the wrapper and passes no `fill`
 * (the WAAPI default, `"none"`), so a swap that never finishes — same hidden
 * tab, cancelled, or replaced cases — leaves the wrapper at its natural
 * height instead of pinned to a stale pixel value. A `null` plan (reduced
 * motion, or nothing to animate) means the DOM swap React already made is
 * the whole story: there is nothing left to do.
 */
function runStepSwapAnimation(
  wrapper: HTMLDivElement,
  plan: StepSwapAnimation | null,
): void {
  if (!plan) return;

  if (plan.wrapper) {
    wrapper.animate(plan.wrapper, { ...plan.options, fill: "none" });
  }

  wrapper.animate(plan.incoming, plan.options);
}

export function SetupWizard({
  frontends,
  capabilities,
  backends,
}: SetupWizardProps): React.JSX.Element {
  const posthog = usePostHog();

  const [projectAnswer, setProjectAnswer] = React.useState<string | null>(null);
  const [frontendId, setFrontendId] = React.useState<string | null>(null);
  const [backendId, setBackendId] = React.useState<string | null>(null);
  const [featureIds, setFeatureIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** 1-based, the card currently on screen. */
  const [current, setCurrent] = React.useState(1);
  /** 1-based, the furthest step reached so far. Never decreases — `goTo`
   *  only ever folds a new step number in via `Math.max`, so there is
   *  nowhere a jump-back could accidentally lower it. */
  const [furthest, setFurthest] = React.useState(1);
  /** Gates the URL-sync effect below so it cannot race the restore effect's
   *  own read-then-write with a premature empty write. */
  const [hydrated, setHydrated] = React.useState(false);
  /** Whether the card's heading should render its focus ring the next time
   *  it receives focus. Set by `goTo` from the activating click's
   *  `event.detail` (0 means the keyboard triggered it) — see that
   *  function's comment. Defaults to `true`; irrelevant on the very first
   *  render since the mount effect changes `current` without ever calling
   *  `goTo`, so the heading is never focused then regardless (see
   *  `pendingTransitionRef` below). */
  const [showHeadingFocusRing, setShowHeadingFocusRing] = React.useState(true);

  /** The instruction shown beneath Continue when it was clicked with the
   *  current step's required choice still missing — see the header comment
   *  above. `null` the rest of the time, including on every step that has
   *  no required choice. */
  const [hint, setHint] = React.useState<string | null>(null);
  /** Wraps the project, frontend and backend steps' option list (a
   *  `ChoiceGrid` or a `PickGrid`) so a blocked Continue click can move
   *  focus to the first option — see `focusFirstOption` below. Only one is
   *  ever mounted at a time, since the wizard renders one step's body at a
   *  time. */
  const projectOptionsRef = React.useRef<HTMLDivElement | null>(null);
  const frontendOptionsRef = React.useRef<HTMLDivElement | null>(null);
  const backendOptionsRef = React.useRef<HTMLDivElement | null>(null);

  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mountedRef = React.useRef(true);
  /** Minted lazily on the first copy, then reused for every later copy in
   *  this page view. Held in a ref and never read during render: a value
   *  that appeared mid-render would differ between the server and client
   *  passes. */
  const runIdRef = React.useRef<string | null>(null);

  /** The card wrapper: measured for the height tween, and the node the
   *  transition animates directly (see `runStepSwapAnimation`). */
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  /** Focus target on every step change — the current step's `<h2>`. */
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  /** Set by `goTo` just before the state update that changes `current`;
   *  consumed by the layout effect below once that change has committed.
   *  Only ever non-null for a change `goTo` itself caused — the mount
   *  effect's URL restore changes `current` too, but never through `goTo`,
   *  so it lands on the right step without stealing focus or animating a
   *  transition nobody asked for. */
  const pendingTransitionRef = React.useRef<PendingTransition | null>(null);
  const isFirstRenderRef = React.useRef(true);

  /** Mirrors of `current`/`furthest`, kept in sync below on every render.
   *  `handleBack` and `handleJump` read these instead of closing over
   *  `current`/`furthest` directly, because each is created fresh on every
   *  render and a reader clicking fast enough during the 240ms step-swap
   *  transition can invoke a handler from a superseded render after a newer
   *  one has already committed — that handler's closed-over `current` or
   *  `furthest` would then be one or more steps behind the step number that
   *  is actually true. Reading through a ref instead always sees the latest
   *  committed value regardless of which render created the handler. Do NOT
   *  "simplify" `handleBack`/`handleJump` back to reading `current`/
   *  `furthest` from the closure — that reintroduces the staleness this
   *  exists to prevent. */
  const currentRef = React.useRef(current);
  const furthestRef = React.useRef(furthest);
  currentRef.current = current;
  furthestRef.current = furthest;

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const allowlists: WizardUrlAllowlists = React.useMemo(
    () => ({
      projectAnswers: PROJECT_ANSWER_IDS,
      frontends: frontends.map((pick) => pick.id),
      features: capabilities.map((capability) => capability.id),
      backends: backends.map((pick) => pick.id),
    }),
    [frontends, capabilities, backends],
  );

  // Mount only. Restores the reader's selections from the URL and lands on
  // the first unanswered step (see `landingStep`) — never through `goTo`,
  // so this never animates and never steals focus; see the comment on
  // `pendingTransitionRef` above.
  //
  // A *layout* effect, not a passive one: the server-rendered HTML (and the
  // very first client render, before this runs) is always step 1, which is
  // correct for a no-JS reader and must stay that way. But a JS-enabled
  // reader reloading with selections in the query string needs the restored
  // step in the first frame that reaches the screen — a passive effect runs
  // after paint, so step 1 would flash before the jump to the restored
  // step. Running the restore in a layout effect instead folds it into the
  // same commit-before-paint window the browser is about to render, so the
  // reader only ever sees the restored step. `useIsomorphicLayoutEffect`
  // (see that module) falls back to a passive effect during server
  // rendering, where `useLayoutEffect` would otherwise warn.
  useIsomorphicLayoutEffect(() => {
    const restored = parseWizardUrlState(window.location.search, allowlists);
    const landing = landingStep(restored);

    setProjectAnswer(restored.project ?? null);
    setFrontendId(restored.frontend ?? null);
    setBackendId(restored.backend ?? null);
    setFeatureIds(new Set(restored.features));
    setCurrent(landing);
    setFurthest(furthestFromAnswers(restored, landing));
    setHydrated(true);
    // Allow-lists are derived from props on every render; only the actual
    // browser URL should ever trigger this restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the query string in sync with every selection, using
  // `replaceState` (never `pushState`) so each pick does not add its own
  // browser-history entry. Skipped before hydration so it cannot race the
  // mount effect's own restore-then-write with a premature empty write.
  React.useEffect(() => {
    if (!hydrated) return;
    const search = serializeWizardUrlState({
      project: projectAnswer ?? undefined,
      frontend: frontendId ?? undefined,
      features: [...featureIds],
      backend: backendId ?? undefined,
    });
    const url = search
      ? `${window.location.pathname}?${search}`
      : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  }, [projectAnswer, frontendId, featureIds, backendId, hydrated]);

  // Runs the step-swap animation and moves focus to the new card's heading
  // — on every `goTo`-driven step change, and only then: not on the first
  // render, and not on the mount effect's URL restore (see
  // `pendingTransitionRef`). `useLayoutEffect` so the measurement inside
  // `runStepSwapAnimation` happens after the new card has committed but
  // before the browser paints an un-animated jump.
  React.useLayoutEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    const pending = pendingTransitionRef.current;
    pendingTransitionRef.current = null;
    if (!pending) return;

    headingRef.current?.focus();

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const toHeight = wrapper.getBoundingClientRect().height;
    const plan = planStepSwap({
      direction: pending.direction,
      fromHeight: pending.fromHeight,
      toHeight,
      reducedMotion: prefersReducedMotion(),
    });

    runStepSwapAnimation(wrapper, plan);
  }, [current]);

  /** The only place `current`/`furthest` ever change once mounted. Always
   *  records a pending transition first — measuring the wrapper's height
   *  synchronously, before React swaps its children — so the layout effect
   *  above has a `fromHeight` to tween from once the new card lands. Also
   *  clears `hint`: every navigation, including a jump back to the very
   *  step that showed it, lands on a freshly-unblocked view rather than a
   *  stale instruction.
   *
   *  `pointerActivated` is `event.detail > 0` on the click that asked for
   *  this navigation — see `WizardNav`/`WizardProgress`'s doc comments. It
   *  decides `showHeadingFocusRing` for the step that is about to render:
   *  the heading still receives focus unconditionally (the layout effect
   *  above), but a pointer-driven change renders it without the ring, since
   *  a mouse user should not see a focus ring around a heading that is not
   *  interactive. */
  function goTo(
    step: number,
    direction: StepDirection,
    pointerActivated: boolean,
  ) {
    const wrapper = wrapperRef.current;
    pendingTransitionRef.current = {
      direction,
      fromHeight: wrapper ? wrapper.getBoundingClientRect().height : 0,
    };
    setHint(null);
    setCurrent(step);
    setFurthest((prev) => Math.max(prev, step));
    setShowHeadingFocusRing(!pointerActivated);
  }

  /** Step 1's Continue: advances only once the project question is
   *  answered. Otherwise shows the hint and moves focus into the option
   *  list instead of advancing. */
  function handleContinueProject(pointerActivated: boolean) {
    if (projectAnswer === null) {
      setHint("Answer this question first");
      focusFirstOption(projectOptionsRef);
      return;
    }
    goTo(2, "forward", pointerActivated);
  }

  /** Step 2's Continue: advances only once a frontend is picked. Otherwise
   *  shows the hint and moves focus into the frontend list instead of
   *  advancing. */
  function handleContinueFrontend(pointerActivated: boolean) {
    if (frontendId === null) {
      setHint("Choose your frontend first");
      focusFirstOption(frontendOptionsRef);
      return;
    }
    goTo(3, "forward", pointerActivated);
  }

  /** Step 3's Continue: same shape as `handleContinueFrontend`, for the
   *  agent backend choice. */
  function handleContinueBackend(pointerActivated: boolean) {
    if (backendId === null) {
      setHint("Choose your agent backend first");
      focusFirstOption(backendOptionsRef);
      return;
    }
    goTo(4, "forward", pointerActivated);
  }

  /** Guards the progress rail against ever landing past `furthest` —
   *  `wizard-stepper-parts` already disables that button's real `disabled`
   *  attribute, but this is the second, independent check: nothing here
   *  trusts the child component alone to enforce it. Reads `furthestRef`/
   *  `currentRef` rather than the closed-over `furthest`/`current` — see
   *  the comment on those refs above for why. Both callers that reach this
   *  — the rail's own `onJump` and `WizardReview`'s `onNavigate` — compute
   *  `pointerActivated` next to their own click and always pass it; the
   *  default here is only a defensive fallback for a caller that cannot
   *  derive one, not something either caller actually relies on. */
  function handleJump(step: number, pointerActivated = false) {
    if (step > furthestRef.current) return;
    if (step === currentRef.current) return;
    goTo(
      step,
      step > currentRef.current ? "forward" : "back",
      pointerActivated,
    );
  }

  /** Reads `currentRef`, not the closed-over `current` — see the comment on
   *  that ref above for why. */
  function handleBack(pointerActivated: boolean) {
    goTo(currentRef.current - 1, "back", pointerActivated);
  }

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never break a copy that already landed on the
      // clipboard — see the same guard in `channels-start-prompt.tsx`.
    }
  }

  async function handleCopy() {
    runIdRef.current ??= createOnboardingRunId();
    const runId = runIdRef.current;

    const frontendPick =
      frontends.find((pick) => pick.id === frontendId) ?? null;
    const backendPick = backends.find((pick) => pick.id === backendId) ?? null;
    const featureTitles = capabilities
      .filter((capability) => featureIds.has(capability.id))
      .map((capability) => capability.title);

    // Composed via the shared helper, which builds the string through plain
    // concatenation — never `innerHTML`. The prompt contains `<run-id>` and
    // `--coding-agent <coding-agent-slug>`; an HTML parser would read those
    // as tags and silently drop them, leaving a broken command on the
    // clipboard, which is exactly what the prototype shipped before this was
    // caught.
    const prompt = composeWizardOnboardingPrompt(runId, {
      frontend: frontendPick
        ? { id: frontendPick.id, name: frontendPick.name }
        : null,
      backend: backendPick
        ? { id: backendPick.id, name: backendPick.name }
        : null,
      featureTitles,
      // `parseWizardUrlState`/`ChoiceGrid` only ever put "yes" or "no" here
      // (see `PROJECT_ANSWER_IDS`), so the narrowing below is exhaustive,
      // not a guess.
      project:
        projectAnswer === "yes" || projectAnswer === "no"
          ? projectAnswer
          : null,
    });

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    // Its own try block, deliberately not shared with the analytics call
    // below: a throwing analytics client must never report a copy as
    // blocked when the prompt already reached the clipboard, and vice
    // versa. See `channels-start-prompt.tsx`'s header comment for the
    // incident this guards against.
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      if (!mountedRef.current) return;
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopyState("idle");
      }, 2600);
      return;
    }

    if (!mountedRef.current) return;
    setCopyState("copied");
    capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
      onboarding_run_id: runId,
      project: projectAnswer,
      frontend: frontendId,
      backend: backendId,
      features: [...featureIds],
    });
    resetTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopyState("idle");
    }, 1800);
  }

  const selectedFeatureIds = React.useMemo(() => [...featureIds], [featureIds]);

  let stepName: string;
  let stepDescription: string;
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (current === 1) {
    stepName = "Do you already have a project?";
    stepDescription =
      "This decides whether the prompt below tells your coding agent to add CopilotKit to it or to start fresh.";
    body = (
      <div ref={projectOptionsRef}>
        <ChoiceGrid
          options={PROJECT_OPTIONS}
          selectedId={projectAnswer ?? undefined}
          disabled={false}
          onSelect={(id) => {
            setProjectAnswer(id);
            setHint(null);
          }}
        />
      </div>
    );
    footer = (
      <WizardNav
        onContinue={handleContinueProject}
        continueLabel="Continue"
        hint={hint ?? undefined}
      />
    );
  } else if (current === 2) {
    stepName = "Your frontend";
    stepDescription =
      "CopilotKit ships the same primitives for every one of these.";
    body = (
      <div ref={frontendOptionsRef}>
        <PickGrid
          picks={frontends}
          selectedId={frontendId ?? undefined}
          disabled={false}
          onSelect={(id) => {
            setFrontendId(id);
            setHint(null);
          }}
          size="card"
        />
      </div>
    );
    footer = (
      <WizardNav
        onBack={handleBack}
        onContinue={handleContinueFrontend}
        continueLabel="Continue"
        hint={hint ?? undefined}
      />
    );
  } else if (current === 3) {
    stepName = "Your agent backend";
    stepDescription =
      "Any framework that speaks AG-UI, or CopilotKit's own built-in agent.";
    body = (
      <div ref={backendOptionsRef}>
        <PickGrid
          picks={backends}
          selectedId={backendId ?? undefined}
          disabled={false}
          onSelect={(id) => {
            setBackendId(id);
            setHint(null);
          }}
        />
      </div>
    );
    footer = (
      <WizardNav
        onBack={handleBack}
        onContinue={handleContinueBackend}
        continueLabel="Continue"
        hint={hint ?? undefined}
      />
    );
  } else if (current === 4) {
    stepName = "What you want to build";
    stepDescription =
      "Pick as many as you like, or skip. This guides your coding agent, it does not restrict it.";
    body = (
      <CapabilityGrid
        capabilities={capabilities}
        selectedIds={selectedFeatureIds}
        disabled={false}
        onToggle={(id) =>
          setFeatureIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    );
    footer = (
      <WizardNav
        onBack={handleBack}
        onContinue={(pointerActivated) => goTo(5, "forward", pointerActivated)}
        continueLabel={featureIds.size > 0 ? "Continue" : "Skip"}
      />
    );
  } else {
    stepName = "Ready to set up";
    stepDescription =
      "Below is what you chose at each step. Copy the prompt and hand it to your coding agent, and it takes care of the setup.";

    const frontendPick =
      frontends.find((pick) => pick.id === frontendId) ?? null;
    const backendPick = backends.find((pick) => pick.id === backendId) ?? null;
    const selectedCapabilities = capabilities.filter((capability) =>
      featureIds.has(capability.id),
    );

    // A review panel, not a fifth pick: the four answers so far, each its
    // own row in `WizardReview` with a `Change` back to the step it came
    // from — see that file's header comment for why the whole row is the
    // control rather than a small trailing button. The copy action lives in
    // `WizardNav`'s primary slot, exactly where Continue sits on every other
    // step — see `wizard-stepper-parts.tsx`'s `ACCENT_BUTTON_CLASS` comment
    // for the shared control this still reuses.
    body = (
      <WizardReview
        project={
          projectAnswer === "yes" || projectAnswer === "no"
            ? projectAnswer
            : null
        }
        frontend={frontendPick}
        backend={backendPick}
        features={selectedCapabilities}
        onNavigate={handleJump}
      />
    );
    footer = (
      <WizardNav
        onBack={handleBack}
        onContinue={handleCopy}
        continueLabel={COPY_LABEL[copyState]}
        continueIcon={<Copy aria-hidden="true" className="h-4 w-4" />}
        secondaryAction={
          <Link href="/quickstart" className={QUIET_BUTTON_CLASS}>
            Set up manually
          </Link>
        }
      />
    );
  }

  return (
    <div className="not-prose flex flex-col gap-5">
      <WizardProgress
        steps={STEPPER_STEPS}
        current={current}
        furthest={furthest}
        onJump={handleJump}
      />
      <div ref={wrapperRef} className="relative">
        <WizardCard
          step={current}
          total={TOTAL_STEPS}
          name={stepName}
          description={stepDescription}
          headingRef={headingRef}
          footer={footer}
          showFocusRing={showHeadingFocusRing}
        >
          {body}
        </WizardCard>
      </div>
      {/* The persistent "Prefer to set it up yourself?" link that used to sit
       *  here is gone. It existed for the no-JavaScript reader, stuck on
       *  step 1 with no working Continue and otherwise no way out. That
       *  reason no longer holds: the page now ends with the restored
       *  backend grid below the wizard, whose server-rendered HTML carries
       *  real anchors — `/quickstart` first among them — reachable with no
       *  script running at all. Step 5's own "Set up manually" action (see
       *  `secondaryAction` above) covers the JavaScript case, same as
       *  before. */}
      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </div>
  );
}
