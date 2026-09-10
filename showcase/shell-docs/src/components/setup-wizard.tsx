"use client";

// <SetupWizard> — the client component that owns the homepage setup wizard's
// state and drives the presentational parts in `./docs-map-parts` and
// `./wizard-stepper-parts`.
//
// Classic one-card-at-a-time stepper: frontend, agent backend, features,
// copy prompt. This component owns exactly three pieces of bookkeeping: the
// three selections, the currently displayed step (`current`), and the
// furthest step the reader has reached (`furthest`, 1-based, never
// decreases). The progress rail's disabled treatment for steps beyond
// `furthest` is `wizard-stepper-parts`' job; this file only ever hands it
// the number.
//
// Steps 1 and 2 each have a required choice, and Continue is never disabled
// — `WizardNav`'s primary button always takes the click. When the required
// choice is still missing, `handleContinueStep1`/`handleContinueStep2` below
// catch the click instead of calling `goTo`: they set `hint` to a short
// instruction (`WizardNav` renders it in a reserved, always-present row so
// it cannot move the footer) and move focus into that step's option list via
// `step1OptionsRef`/`step2OptionsRef`, so a keyboard user lands where the
// work is instead of stuck on a button that just did nothing. `hint` clears
// the moment the choice is made (the `PickGrid` `onSelect` handlers below
// clear it directly) and on every navigation (`goTo` clears it too), so it
// never lingers once it is no longer true and never reappears on a plain
// step change.
//
// Changing an earlier answer must never clear a later one: going back to
// step 1 and picking a different frontend leaves the backend and the
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
import { Copy } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { CapabilityGrid, PickGrid } from "@/components/docs-map-parts";
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
  ACCENT_BUTTON_CLASS,
  PRIMARY_BUTTON_MIN_WIDTH_CLASS,
  WizardCard,
  WizardNav,
  WizardProgress,
} from "@/components/wizard-stepper-parts";
import type { StepperStep } from "@/components/wizard-stepper-parts";

export interface SetupWizardProps {
  frontends: readonly MapPick[];
  capabilities: readonly MapCapability[];
  backends: readonly MapPick[];
}

type CopyState = "idle" | "copied" | "error";

const TOTAL_STEPS = 4;

const STEPPER_STEPS: readonly StepperStep[] = [
  { n: 1, label: "Frontend" },
  { n: 2, label: "Backend" },
  { n: 3, label: "Features" },
  { n: 4, label: "Prompt" },
];

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy prompt",
  copied: "Copied",
  error: "Copy blocked",
};

/**
 * The step a restored URL — or a fresh mount with no query at all — should
 * land on: the first step whose answer is still missing, in the new step
 * order (frontend, backend, features, prompt), or step 4 once every answer,
 * including the optional features step, has something in it. A shared link
 * should open where there is something left to do, not back at step 1.
 */
function landingStep(restored: WizardUrlState): number {
  if (!restored.frontend) return 1;
  if (!restored.backend) return 2;
  if (restored.features.length === 0) return 3;
  return 4;
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

/** The quiet control on the right of each of step 4's review rows. Small and
 *  muted on purpose — it is a secondary action next to the row's value, not
 *  competing with the copy button below the list. */
const REVIEW_CHANGE_BUTTON_CLASS =
  "shell-docs-radius-control shrink-0 cursor-pointer px-2 py-1 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none";

/** One row of step 4's review list: an uppercase label, the picked value (or
 *  a muted "None" when `value` is `null`, which is how the features row
 *  stays offered even with nothing chosen), and a `Change` control that
 *  jumps back to the step that answer came from. `Change` shows the same
 *  short word on every row, but needs a distinct accessible name per row —
 *  three buttons all named "Change" would be indistinguishable in a screen
 *  reader's element list — so `changeLabel` (e.g. "Change frontend") goes in
 *  `aria-label`. It contains the visible text "Change", so this still
 *  satisfies the label-in-name rule. Module-level rather than a closure
 *  inside `SetupWizard`: it captures nothing from that component's scope. */
function ReviewRow({
  label,
  value,
  changeLabel,
  onChange,
}: {
  label: string;
  value: string | null;
  changeLabel: string;
  onChange: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-3">
      <dt className="w-24 shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] sm:w-32">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm font-medium text-[var(--text)]">
        {value ?? <span className="text-[var(--text-muted)]">None</span>}
      </dd>
      <button
        type="button"
        onClick={onChange}
        aria-label={changeLabel}
        className={REVIEW_CHANGE_BUTTON_CLASS}
      >
        Change
      </button>
    </div>
  );
}

export function SetupWizard({
  frontends,
  capabilities,
  backends,
}: SetupWizardProps): React.JSX.Element {
  const posthog = usePostHog();

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

  /** The instruction shown beneath Continue when it was clicked with the
   *  current step's required choice still missing — see the header comment
   *  above. `null` the rest of the time, including on every step that has
   *  no required choice. */
  const [hint, setHint] = React.useState<string | null>(null);
  /** Wraps step 1's and step 2's `PickGrid` so a blocked Continue click can
   *  move focus to the first option — see `focusFirstOption` below. Only
   *  one is ever mounted at a time, since the wizard renders one step's body
   *  at a time. */
  const step1OptionsRef = React.useRef<HTMLDivElement | null>(null);
  const step2OptionsRef = React.useRef<HTMLDivElement | null>(null);

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

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const allowlists: WizardUrlAllowlists = React.useMemo(
    () => ({
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
  React.useEffect(() => {
    const restored = parseWizardUrlState(window.location.search, allowlists);
    const landing = landingStep(restored);

    setFrontendId(restored.frontend ?? null);
    setBackendId(restored.backend ?? null);
    setFeatureIds(new Set(restored.features));
    setCurrent(landing);
    setFurthest(landing);
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
      frontend: frontendId ?? undefined,
      features: [...featureIds],
      backend: backendId ?? undefined,
    });
    const url = search
      ? `${window.location.pathname}?${search}`
      : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  }, [frontendId, featureIds, backendId, hydrated]);

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
   *  stale instruction. */
  function goTo(step: number, direction: StepDirection) {
    const wrapper = wrapperRef.current;
    pendingTransitionRef.current = {
      direction,
      fromHeight: wrapper ? wrapper.getBoundingClientRect().height : 0,
    };
    setHint(null);
    setCurrent(step);
    setFurthest((prev) => Math.max(prev, step));
  }

  /** Step 1's Continue: advances only once a frontend is picked. Otherwise
   *  shows the hint and moves focus into the frontend list instead of
   *  advancing. */
  function handleContinueStep1() {
    if (frontendId === null) {
      setHint("Choose your frontend first");
      focusFirstOption(step1OptionsRef);
      return;
    }
    goTo(2, "forward");
  }

  /** Step 2's Continue: same shape as `handleContinueStep1`, for the agent
   *  backend choice. */
  function handleContinueStep2() {
    if (backendId === null) {
      setHint("Choose your agent backend first");
      focusFirstOption(step2OptionsRef);
      return;
    }
    goTo(3, "forward");
  }

  /** Guards the progress rail against ever landing past `furthest` —
   *  `wizard-stepper-parts` already disables that button's real `disabled`
   *  attribute, but this is the second, independent check: nothing here
   *  trusts the child component alone to enforce it. */
  function handleJump(step: number) {
    if (step > furthest) return;
    if (step === current) return;
    goTo(step, step > current ? "forward" : "back");
  }

  function handleBack() {
    goTo(current - 1, "back");
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
    stepName = "Your frontend";
    stepDescription =
      "CopilotKit ships the same primitives for every one of these.";
    body = (
      <div ref={step1OptionsRef}>
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
        onContinue={handleContinueStep1}
        continueLabel="Continue"
        hint={hint ?? undefined}
      />
    );
  } else if (current === 2) {
    stepName = "Your agent backend";
    stepDescription =
      "Any framework that speaks AG-UI, or CopilotKit's own built-in agent.";
    body = (
      <div ref={step2OptionsRef}>
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
        onContinue={handleContinueStep2}
        continueLabel="Continue"
        hint={hint ?? undefined}
      />
    );
  } else if (current === 3) {
    stepName = "What you want to build";
    stepDescription =
      "Pick as many as you like, or skip — this guides your coding agent, it does not restrict it.";
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
        onContinue={() => goTo(4, "forward")}
        continueLabel={featureIds.size > 0 ? "Continue" : "Skip"}
      />
    );
  } else {
    stepName = "Copy your prompt";
    stepDescription =
      "The canonical onboarding prompt, with your answers appended so your coding agent does not have to ask again.";

    const frontendPick =
      frontends.find((pick) => pick.id === frontendId) ?? null;
    const backendPick = backends.find((pick) => pick.id === backendId) ?? null;
    const featureTitles = capabilities
      .filter((capability) => featureIds.has(capability.id))
      .map((capability) => capability.title);

    // A review list, not a fourth pick: the three answers so far, each with
    // a quiet `Change` back to the step it came from (see `ReviewRow`
    // above), and the copy action — still `WizardNav`'s accent control (see
    // `ACCENT_BUTTON_CLASS`/`PRIMARY_BUTTON_MIN_WIDTH_CLASS`, exported from
    // `wizard-stepper-parts` for exactly this) — centred in the space below
    // the list rather than parked in the footer's corner, since a step this
    // short otherwise reads as an empty card with a button in it.
    body = (
      <div className="flex flex-col">
        <dl className="divide-y divide-[var(--border)]">
          <ReviewRow
            label="Frontend"
            value={frontendPick?.name ?? null}
            changeLabel="Change frontend"
            onChange={() => handleJump(1)}
          />
          <ReviewRow
            label="Agent backend"
            value={backendPick?.name ?? null}
            changeLabel="Change agent backend"
            onChange={() => handleJump(2)}
          />
          <ReviewRow
            label="Features"
            value={featureTitles.length > 0 ? featureTitles.join(" · ") : null}
            changeLabel="Change features"
            onChange={() => handleJump(3)}
          />
        </dl>
        <div className="flex flex-1 items-center justify-center py-6">
          <button
            type="button"
            onClick={handleCopy}
            className={`${ACCENT_BUTTON_CLASS} ${PRIMARY_BUTTON_MIN_WIDTH_CLASS}`}
          >
            <Copy aria-hidden="true" className="h-4 w-4" />
            {COPY_LABEL[copyState]}
          </button>
        </div>
      </div>
    );
    footer = <WizardNav onBack={handleBack} />;
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
        >
          {body}
        </WizardCard>
      </div>
      {/* Always present, not just on step 4: with JavaScript disabled,
       *  Continue's click handler never fires, so a reader lands on step 1
       *  and cannot advance. Without this link that is a dead end — the
       *  manual quickstart would be hidden behind three steps a
       *  no-JS reader can never reach. */}
      <Link
        href="/quickstart"
        className="text-xs text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-secondary)] hover:underline"
      >
        Prefer to set it up yourself? Follow the manual quickstart.
      </Link>
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
