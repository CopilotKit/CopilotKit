"use client";
import {
  ONBOARDING_ARGUMENT_TEXT,
  ONBOARDING_ARGUMENT_VERSION,
} from "@/lib/onboarding-argument-templates";

import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

// <SetupWizard> — the client component that owns the homepage setup wizard's
// state and drives `./wizard-rail`, `./wizard-stepper-parts`,
// `./docs-map-parts`, and `./wizard-review`.
//
// One-card-at-a-time setup flow: whether the reader already has a project,
// frontend, agent backend, features, copy prompt. This component
// owns exactly three pieces of bookkeeping: the four selections, the
// currently displayed step (`current`), and the furthest step the reader
// has reached (`furthest`, never decreases). The progress rail's
// disabled treatment for steps beyond `furthest` is `wizard-rail`'s
// job; this file only ever hands it the number. On mount, `furthest` is
// seeded from the first unanswered required step. Later saved answers stay
// available without letting the reader bypass a missing prerequisite.
//
// `handleJump` reads `current`/`furthest` through
// `currentRef`/`furthestRef` rather than closing over the state values —
// see the comment on those refs for why.
//
// Single-choice steps advance on selection. Features remain multi-select,
// with an explicit Continue/Skip action. Returning preserves every answer.
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
import { WizardBackendPicker } from "./wizard-backend-picker";
import { Copy } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { CapabilityGrid, PickGrid } from "@/components/docs-map-parts";
import { frontendPathForBackend, isFrontendId } from "@/lib/frontend-options";
import { WizardReview } from "@/components/wizard-review";
import { WizardRail } from "@/components/wizard-rail";
import type { WizardStep } from "@/components/wizard-rail";
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
import { onboardingFrameworkSlug } from "@/lib/intelligence-onboarding-framework";
import { composeWizardOnboardingPrompt } from "@/lib/wizard-onboarding-prompt";

import {
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";
import {
  ChoiceGrid,
  PROJECT_ANSWER_ICONS,
  QUIET_BUTTON_CLASS,
  WizardCard,
  WizardNav,
} from "@/components/wizard-stepper-parts";
import type { ChoiceOption } from "@/components/wizard-stepper-parts";

export interface SetupWizardProps {
  frontends: readonly MapPick[];
  capabilities: readonly MapCapability[];
  backends: readonly MapPick[];
  /** Partner routes fix this backend and omit its selection step. */
  fixedBackend?: string;
  defaultFrontend?: string;
}

type CopyState = "idle" | "copied" | "error";

// Names this control in `docs.intelligence_onboarding_prompt_copied`, the event
// <PromptPill> also emits from the docs hero and page tools. Every other
// emitter sets `surface`, so a wizard copy without one is the only row in that
// stream that cannot be attributed to a control.
const WIZARD_COPY_SURFACE = "docs_setup_wizard";

const STEPPER_STEPS: readonly WizardStep[] = [
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

/** The two answers to step 1's "What are you building?" — also the
 *  allow-list `parseWizardUrlState` validates a restored `project` query
 *  value against, so the ids a reader can pick and the ids a URL is allowed
 *  to carry can never drift apart. */
const PROJECT_ANSWER_IDS = ["yes", "no"] as const;

const PROJECT_OPTIONS: readonly ChoiceOption[] = [
  {
    id: "yes",
    label: "Existing project",
    description: "Add CopilotKit to what you have",
    icon: PROJECT_ANSWER_ICONS.yes,
  },
  {
    id: "no",
    label: "New project",
    description: "Start from scratch",
    icon: PROJECT_ANSWER_ICONS.no,
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

/** Direction of the incoming card's animation. */
type StepDirection = "forward" | "back";

export function SetupWizard({
  frontends,
  capabilities,
  backends,
  fixedBackend,
  defaultFrontend,
}: SetupWizardProps): React.JSX.Element {
  const partnerBackend = backends.some((pick) => pick.id === fixedBackend)
    ? fixedBackend
    : undefined;
  const steps = partnerBackend
    ? [
        { n: 0, label: "Setup" },
        ...STEPPER_STEPS.filter((step) => step.n !== 3 && step.n !== 1),
      ]
    : STEPPER_STEPS;
  const posthog = usePostHog();
  const track = useHomepageTelemetry();

  const partnerName = backends.find((pick) => pick.id === partnerBackend)?.name;
  const [agentAnswer, setAgentAnswer] = React.useState<"yes" | "no" | null>(
    null,
  );
  const [projectAnswer, setProjectAnswer] = React.useState<string | null>(null);
  const [frontendId, setFrontendId] = React.useState<string | null>(null);
  const [backendId, setBackendId] = React.useState<string | null>(null);
  const [featureIds, setFeatureIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** Stable step id; partner-only agent context uses 0. */
  const [current, setCurrent] = React.useState(partnerBackend ? 0 : 1);
  /** The furthest step reached so far. Never decreases — `goTo`
   *  only ever folds a new step number in via `Math.max`, so there is
   *  nowhere a jump-back could accidentally lower it. */
  const [furthest, setFurthest] = React.useState(partnerBackend ? 0 : 1);
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

  /** The stable rail wrapper, used to find the incoming card for animation. */
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  /** Focus target on every step change — the current step's `<h2>`. */
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  /** Set by `goTo` just before the state update that changes `current`;
   *  consumed by the layout effect below once that change has committed.
   *  Only ever non-null for a change `goTo` itself caused — the mount
   *  effect's URL restore changes `current` too, but never through `goTo`,
   *  so it lands on the right step without stealing focus or animating a
   *  transition nobody asked for. */
  const pendingTransitionRef = React.useRef<StepDirection | null>(null);
  const isFirstRenderRef = React.useRef(true);

  /** Mirrors of `current`/`furthest`, kept in sync below on every render.
   *  `handleJump` reads these instead of closing over
   *  `current`/`furthest` directly, because each is created fresh on every
   *  render and a reader clicking fast enough during the 240ms step-swap
   *  transition can invoke a handler from a superseded render after a newer
   *  one has already committed — that handler's closed-over `current` or
   *  `furthest` would then be one or more steps behind the step number that
   *  is actually true. Reading through a ref instead always sees the latest
   *  committed value regardless of which render created the handler. Do NOT
   *  "simplify" `handleJump` back to reading `current`/
   *  `furthest` from the closure — that reintroduces the staleness this
   *  exists to prevent. */
  const currentRef = React.useRef(current);
  const furthestRef = React.useRef(furthest);
  currentRef.current = current;
  furthestRef.current = furthest;

  React.useEffect(() => {
    mountedRef.current = true;
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
  // very first client render, before this runs) is the first question, which is
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
    const restored = {
      ...parseWizardUrlState(window.location.search, allowlists),
    };
    // The partner route fixes the backend; saved frontend answers still win.
    if (partnerBackend) restored.backend = partnerBackend;
    // A new project cannot also contain an existing agent. Normalize this
    // contradictory shareable URL to the same starting point the picker emits.
    if (partnerBackend && restored.project === "no") restored.agent = "no";
    restored.frontend ??= allowlists.frontends.includes(defaultFrontend ?? "")
      ? defaultFrontend
      : undefined;
    const landing =
      partnerBackend && (!restored.agent || !restored.project)
        ? 0
        : landingStep(restored);
    setAgentAnswer(restored.agent ?? null);

    setProjectAnswer(restored.project ?? null);
    setFrontendId(restored.frontend ?? null);
    setBackendId(restored.backend ?? null);
    setFeatureIds(new Set(restored.features));
    setCurrent(landing);
    // Later answers stay saved, but cannot bypass a missing required choice.
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
      agent: partnerBackend ? (agentAnswer ?? undefined) : undefined,
      project: projectAnswer ?? undefined,
      frontend: frontendId ?? undefined,
      features: [...featureIds],
      backend: backendId ?? undefined,
    });
    const url = new URL(window.location.href);
    const answers = new URLSearchParams(search);
    for (const key of ["agent", "project", "frontend", "features", "backend"]) {
      url.searchParams.delete(key);
      const value = answers.get(key);
      if (value !== null) url.searchParams.set(key, value);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [
    agentAnswer,
    projectAnswer,
    frontendId,
    featureIds,
    backendId,
    hydrated,
    partnerBackend,
  ]);

  // Animate the incoming card and focus its heading after a step change.
  // URL restoration never sets a pending transition, so it does neither.
  React.useLayoutEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    const direction = pendingTransitionRef.current;
    pendingTransitionRef.current = null;
    if (!direction) return;

    headingRef.current?.focus({ preventScroll: true });
    if (prefersReducedMotion()) return;

    const distance = direction === "forward" ? 10 : -10;
    wrapperRef.current
      ?.querySelector<HTMLElement>(
        "[data-wizard-current-step] .wizard-step-card",
      )
      ?.animate(
        [
          { opacity: 0.35, transform: `translateX(${distance}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
  }, [current]);

  /** The only place `current`/`furthest` ever change once mounted. Records
   *  a direction for the incoming card's animation. Selected answers are
   *  preserved when moving backward.
   *
   *  `pointerActivated` is `event.detail > 0` on the click that asked for
   *  this navigation — see `WizardNav`/`WizardRail`'s doc comments. It
   *  decides `showHeadingFocusRing` for the step that is about to render:
   *  the heading still receives focus unconditionally (the layout effect
   *  above), but a pointer-driven change renders it without the ring, since
   *  a mouse user should not see a focus ring around a heading that is not
   *  interactive. */
  function goTo(
    step: number,
    direction: StepDirection,
    pointerActivated: boolean,
    selection: Record<string, unknown> = {},
  ) {
    if (partnerBackend && step === 1) step = 0;
    if (partnerBackend && step === 3) step = direction === "back" ? 2 : 4;
    runIdRef.current ??= createOnboardingRunId();
    track("wizard_step_changed", {
      onboarding_run_id: runIdRef.current,
      from_step: currentRef.current,
      to_step: step,
      project: projectAnswer,
      frontend: frontendId,
      backend: backendId,
      features: [...featureIds],
      ...selection,
    });
    pendingTransitionRef.current = direction;
    setCurrent(step);
    setFurthest((prev) => Math.max(prev, step));
    setShowHeadingFocusRing(!pointerActivated);
  }

  /** Guards the progress rail against ever landing past `furthest` —
   *  `wizard-rail` already disables that button's real `disabled`
   *  attribute, but this is the second, independent check: nothing here
   *  trusts the child component alone to enforce it. Reads `furthestRef`/
   *  `currentRef` rather than the closed-over `furthest`/`current` — see
   *  the comment on those refs above for why. Both callers that reach this
   *  — the rail's own `onJump` and `WizardReview`'s `onNavigate` — compute
   *  `pointerActivated` next to their own click and always pass it; the
   *  default here is only a defensive fallback for a caller that cannot
   *  derive one, not something either caller actually relies on. */
  function handleJump(step: number, pointerActivated = false) {
    if (partnerBackend && step === 3) return;
    if (step > furthestRef.current) return;
    if (step === currentRef.current) return;
    goTo(
      step,
      step > currentRef.current ? "forward" : "back",
      pointerActivated,
    );
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
      agent: partnerBackend ? agentAnswer : undefined,
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
      // The wizard has one copy control and never hands the prompt to an app,
      // so every write here is a deliberate copy. <PromptPill> emits this same
      // event for its `open_claude`/`open_codex` deep links; without `action`
      // the two are indistinguishable downstream. See PE-218.
      action: "copy",
      surface: WIZARD_COPY_SURFACE,
      // Read at click time rather than through `usePathname`, matching how the
      // rest of this component reads the URL it rewrites as the user answers.
      from_path: window.location.pathname,
      onboarding_run_id: runId,
      project: projectAnswer,
      frontend: frontendId,
      // The wizard's fifth argument. It reaches the copied prompt through
      // `composeWizardOnboardingPrompt` and was the only one telemetry could
      // not see, so a run seeded with "I already have an agent" was
      // indistinguishable from one seeded with "I need a new agent" (PE-255).
      // `undefined` for a backend with no partner question, matching the
      // composer, and PostHog drops the key rather than recording a null.
      agent: partnerBackend ? (agentAnswer ?? undefined) : undefined,
      backend: backendId,
      // `backend` is the docs registry slug this picker works in; the hero
      // button and page actions emit `agent_framework` already mapped to the
      // onboarding graph's vocabulary. Grouping the two together on `backend`
      // would split `strands` from `strands-python` without saying so, and
      // `built-in-agent` maps to nothing at all. Both are emitted rather than
      // renaming `backend`, because dashboards already read it (PE-255).
      agent_framework: backendId
        ? onboardingFrameworkSlug(backendId)
        : undefined,
      features: [...featureIds],
      // Which revision of the argument prose the wizard appended. The
      // hosted document versions its own text; this is the other half
      // of what the developer copied (PE-255).
      argument_version: ONBOARDING_ARGUMENT_VERSION,
      argument_text: ONBOARDING_ARGUMENT_TEXT,
    });
    resetTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopyState("idle");
    }, 1800);
  }

  const selectedFeatureIds = React.useMemo(() => [...featureIds], [featureIds]);

  const frontend =
    frontendId && isFrontendId(frontendId) ? frontendId : "react";
  const backend = backendId === "built-in-agent" ? null : backendId;
  const manualSetupHref =
    frontend === "react"
      ? backend
        ? `/${backend}/quickstart`
        : "/quickstart"
      : frontendPathForBackend(frontend, "quickstart", backend);

  let stepName: string;
  let stepDescription: string;
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (current === 0 && partnerBackend) {
    stepName = "What are you building?";
    stepDescription = "Tell us what you already have. We’ll tailor your setup.";
    body = (
      <ChoiceGrid
        options={[
          {
            ...PROJECT_OPTIONS[0],
            id: "existing",
            description: `Add a ${partnerName} agent to your app`,
          },
          {
            ...PROJECT_OPTIONS[0],
            id: "existing-agent",
            label: "Existing agent",
            description: `Connect your ${partnerName} agent to your app`,
          },
          {
            ...PROJECT_OPTIONS[1],
            id: "new",
            description: "Build an app and agent from scratch",
          },
        ]}
        selectedId={
          projectAnswer === "no"
            ? "new"
            : projectAnswer === "yes" && agentAnswer
              ? agentAnswer === "yes"
                ? "existing-agent"
                : "existing"
              : undefined
        }
        onSelect={(id, pointerActivated) => {
          const project = id === "new" ? "no" : "yes";
          const agent = id === "existing-agent" ? "yes" : "no";
          setProjectAnswer(project);
          setAgentAnswer(agent);
          goTo(2, "forward", pointerActivated, { project, agent });
        }}
      />
    );
    footer = null;
  } else if (current === 1) {
    stepName = "What are you building?";
    stepDescription =
      "Choose an option to continue. We will tailor the setup to your starting point.";
    body = (
      <div>
        <ChoiceGrid
          options={PROJECT_OPTIONS}
          selectedId={projectAnswer ?? undefined}
          illustrated
          onSelect={(id, pointerActivated) => {
            setProjectAnswer(id);
            goTo(2, "forward", pointerActivated, { project: id });
          }}
        />
      </div>
    );
    footer = null;
  } else if (current === 2) {
    stepName = "Your frontend";
    stepDescription = "Choose the frontend your app uses to continue.";
    body = (
      <div>
        <PickGrid
          picks={frontends}
          selectedId={frontendId ?? undefined}
          onSelect={(id, pointerActivated) => {
            setFrontendId(id);
            goTo(3, "forward", pointerActivated, { frontend: id });
          }}
        />
      </div>
    );
    footer = null;
  } else if (current === 3) {
    stepName = "Your agent backend";
    stepDescription =
      "Choose your agent framework to continue, or start with CopilotKit's built-in agent.";
    body = (
      <div>
        <WizardBackendPicker
          picks={backends}
          selectedId={backendId ?? undefined}
          onSelect={(id, pointerActivated) => {
            setBackendId(id);
            goTo(4, "forward", pointerActivated, { backend: id });
          }}
        />
      </div>
    );
    footer = null;
  } else if (current === 4) {
    stepName = "What you want to build";
    stepDescription =
      "Pick as many as you like, or skip. This guides your coding agent, it does not restrict it.";
    body = (
      <CapabilityGrid
        capabilities={capabilities}
        selectedIds={selectedFeatureIds}
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
        onContinue={(pointerActivated) => goTo(5, "forward", pointerActivated)}
        continueLabel={featureIds.size > 0 ? "Continue" : "Skip"}
      />
    );
  } else {
    stepName = "Ready to set up";
    stepDescription =
      "Below is what you chose at each step. Copy the prompt and paste it into a coding agent running in your project folder. It takes care of the setup.";

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
        backendFixed={Boolean(partnerBackend)}
        agent={partnerBackend ? agentAnswer : undefined}
        features={selectedCapabilities}
        onNavigate={handleJump}
      />
    );
    footer = (
      <WizardNav
        onContinue={handleCopy}
        continueLabel={COPY_LABEL[copyState]}
        continueIcon={<Copy aria-hidden="true" className="h-4 w-4" />}
        secondaryAction={
          <Link
            href={manualSetupHref}
            className={QUIET_BUTTON_CLASS}
            onClick={() => {
              runIdRef.current ??= createOnboardingRunId();
              track("manual_setup_clicked", {
                onboarding_run_id: runIdRef.current,
                project: projectAnswer,
                frontend: frontendId,
                backend: backendId,
                features: [...featureIds],
                destination: manualSetupHref,
              });
            }}
          >
            Set up manually
          </Link>
        }
      />
    );
  }

  const summaries: Readonly<Record<number, string>> = {
    0:
      projectAnswer === "no"
        ? "New project"
        : agentAnswer === "yes"
          ? "Existing agent"
          : "Existing project",
    1: projectAnswer === "yes" ? "Existing project" : "New project",
    2: frontends.find((pick) => pick.id === frontendId)?.name ?? "",
    3: backends.find((pick) => pick.id === backendId)?.name ?? "",
    4: featureIds.size ? `${featureIds.size} selected` : "Skipped",
  };

  const selectedSteps = new Set<number>();
  if (projectAnswer && agentAnswer) selectedSteps.add(0);
  if (projectAnswer) selectedSteps.add(1);
  if (frontendId) selectedSteps.add(2);
  if (backendId) selectedSteps.add(3);
  if (featureIds.size) selectedSteps.add(4);

  return (
    <div className="not-prose flex flex-col gap-5">
      <div ref={wrapperRef} className="wizard-layout-root relative">
        <WizardRail
          steps={steps}
          current={current}
          furthest={furthest}
          summaries={summaries}
          selectedSteps={selectedSteps}
          onJump={handleJump}
        >
          <WizardCard
            name={stepName}
            description={stepDescription}
            headingRef={headingRef}
            footer={footer}
            showFocusRing={showHeadingFocusRing}
          >
            {body}
          </WizardCard>
        </WizardRail>
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
