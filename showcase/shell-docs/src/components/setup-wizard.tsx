"use client";

// <SetupWizard> — the client component that owns the homepage setup wizard's
// state and drives the presentational parts in `./docs-map-parts`.
//
// Four steps: pick a frontend (single), pick features (multiple, optional),
// pick an agent backend (single), copy a prompt carrying all three answers.
// This component owns exactly two pieces of bookkeeping: the three
// selections, and how far the reader has got (`reached`, 1-based, never
// decreases). Every step's `StepState` is derived from those two things —
// see `stepState` below — so there is nowhere else a step's
// locked/active/done status can drift out of sync with the actual
// selections.
//
// Advance is forward-only, and that rule is the single most load-bearing
// thing in this file: reaching a step for the FIRST time is what unlocks
// the next step and scrolls to it. Re-answering an earlier step (e.g.
// picking a different frontend after already reaching step 3) must change
// only that selection — no reset of later answers, no re-scroll. Each of
// the three "select" handlers below computes `firstTime` from `reached`
// BEFORE updating anything, and only unlocks/scrolls when it is true. This
// is a plain boolean read, not something inferred from whether React
// decides to re-render — a mutation that deletes the check is meant to be
// visible in the mutation-testing pass, not silently absorbed by React's
// own bail-out-on-unchanged-state behaviour.
//
// Steps 1–3 always exist in the DOM (only their `disabled`/state treatment
// changes), so their scroll target can be looked up and scrolled to
// synchronously, inside the same click handler that decided to advance.
// Step 4 does not exist until a backend is chosen, so scrolling to it can
// only happen after React has committed that render — `pendingStep4ScrollRef`
// records the decision made in the handler, and the effect keyed on
// `backendId` consumes it once the section is actually on the page.
//
// This component reads no data of its own: no `@/lib/registry`, no
// `frontendPicks()` / `agentPicks()`. Those pull in the ~646 KB registry,
// and importing them here would ship that registry to the browser — this is
// the only client module in the wizard, so anything it imports crosses the
// boundary. The server shell (a later task) reads the registry and passes
// the three prop arrays down.

import React from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import {
  CapabilityGrid,
  MAP_GRID_CLASS,
  PickGrid,
  StepBlock,
  StepConnector,
} from "@/components/docs-map-parts";
import type { StepState } from "@/components/docs-map-parts";
import type { MapCapability, MapPick } from "@/lib/homepage-map";
import {
  parseWizardUrlState,
  serializeWizardUrlState,
} from "@/lib/wizard-url-state";
import type { WizardUrlAllowlists } from "@/lib/wizard-url-state";
import { scrollElementIntoCenter } from "@/lib/wizard-scroll";
import { composeWizardOnboardingPrompt } from "@/lib/wizard-onboarding-prompt";
import {
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";

export interface SetupWizardProps {
  frontends: readonly MapPick[];
  capabilities: readonly MapCapability[];
  backends: readonly MapPick[];
}

type CopyState = "idle" | "copied" | "error";

/** DOM ids the wizard's own steps live at — shared between the JSX below
 *  (so `StepBlock` renders them) and the handlers that scroll to them. */
const STEP_DOM_ID = {
  2: "wizard-step-2",
  3: "wizard-step-3",
  4: "wizard-step-4",
} as const;

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy prompt",
  copied: "Copied",
  error: "Copy blocked",
};

export function SetupWizard({
  frontends,
  capabilities,
  backends,
}: SetupWizardProps): React.JSX.Element {
  const posthog = usePostHog();

  const [frontendId, setFrontendId] = React.useState<string | null>(null);
  const [featureIds, setFeatureIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [backendId, setBackendId] = React.useState<string | null>(null);
  /** 1-based, the furthest step reached so far. Never decreases. */
  const [reached, setReached] = React.useState(1);
  /** Gates the locked/disabled treatment. False until the client mounts, so
   *  a no-JS reader sees every step enabled rather than a wizard permanently
   *  stuck on step 1 — see the header comment in `docs-map-parts.tsx`. */
  const [hydrated, setHydrated] = React.useState(false);

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
  /** Set by `handleSelectBackend` exactly when step 4 is being reached for
   *  the first time. Step 4 is not in the DOM yet at that point, so the
   *  actual scroll is deferred to the effect below, which runs once the
   *  section has been committed. */
  const pendingStep4ScrollRef = React.useRef(false);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (!pendingStep4ScrollRef.current) return;
    pendingStep4ScrollRef.current = false;
    const el = document.getElementById(STEP_DOM_ID[4]);
    if (el) scrollElementIntoCenter(el);
    // Only `backendId` — not `reached` — needs to gate this: the flag above
    // already carries the "was this the first time" decision, so this
    // effect only needs to know that a render exposing the step 4 section
    // has happened.
  }, [backendId]);

  const allowlists: WizardUrlAllowlists = React.useMemo(
    () => ({
      frontends: frontends.map((pick) => pick.id),
      features: capabilities.map((capability) => capability.id),
      backends: backends.map((pick) => pick.id),
    }),
    [frontends, capabilities, backends],
  );

  // Mount only. Restores the reader's selections from the URL and flips on
  // the locked/disabled treatment together, so hydration never paints an
  // intermediate frame where the restored answers show but the earlier
  // steps still look locked (or vice versa). This never scrolls: it does
  // not go through any of the "select" handlers, which are the only place a
  // scroll is ever triggered from.
  React.useEffect(() => {
    const restored = parseWizardUrlState(window.location.search, allowlists);
    // A restored backend implies steps 2 and 3 were already passed through
    // (there is no way to reach a backend selection otherwise); a restored
    // frontend alone only implies step 2 is reachable, leaving step 2's own
    // Skip/Confirm choice to the reader.
    const restoredReached = restored.backend ? 4 : restored.frontend ? 2 : 1;

    setFrontendId(restored.frontend ?? null);
    setFeatureIds(new Set(restored.features));
    setBackendId(restored.backend ?? null);
    setReached(restoredReached);
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

  function isLocked(step: number): boolean {
    return hydrated && reached < step;
  }

  function stepState(step: number, answered: boolean): StepState {
    if (isLocked(step)) return "locked";
    return answered ? "done" : "active";
  }

  function handleSelectFrontend(id: string) {
    const firstTime = reached < 2;
    setFrontendId(id);
    if (firstTime) {
      setReached(2);
      const el = document.getElementById(STEP_DOM_ID[2]);
      if (el) scrollElementIntoCenter(el);
    }
  }

  function handleToggleFeature(id: string) {
    setFeatureIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleStep2Continue() {
    const firstTime = reached < 3;
    if (firstTime) {
      setReached(3);
      const el = document.getElementById(STEP_DOM_ID[3]);
      if (el) scrollElementIntoCenter(el);
    }
  }

  function handleSelectBackend(id: string) {
    const firstTime = reached < 4;
    setBackendId(id);
    if (firstTime) {
      setReached(4);
      pendingStep4ScrollRef.current = true;
    }
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

  const frontendDone = frontendId !== null;
  const step2Done = reached > 2;
  const backendDone = backendId !== null;

  const frontendName = frontendId
    ? frontends.find((pick) => pick.id === frontendId)?.name
    : undefined;
  const backendName = backendId
    ? backends.find((pick) => pick.id === backendId)?.name
    : undefined;

  const selectedFeatureIds = React.useMemo(() => [...featureIds], [featureIds]);

  return (
    <div className={MAP_GRID_CLASS}>
      <StepBlock
        state={stepState(1, frontendDone)}
        step={1}
        name="Your frontend"
        description="CopilotKit ships the same primitives for every one of these."
        hint={frontendDone ? frontendName : undefined}
      >
        <PickGrid
          picks={frontends}
          selectedId={frontendId ?? undefined}
          disabled={isLocked(1)}
          onSelect={handleSelectFrontend}
        />
      </StepBlock>

      <StepConnector lit={reached >= 2} />

      <StepBlock
        id={STEP_DOM_ID[2]}
        state={stepState(2, step2Done)}
        step={2}
        name="What you want to build"
        description="Pick as many as you like, or skip — this guides your coding agent, it does not restrict it."
        hint={isLocked(2) ? "Choose your frontend first" : undefined}
      >
        <CapabilityGrid
          capabilities={capabilities}
          selectedIds={selectedFeatureIds}
          disabled={isLocked(2)}
          onToggle={handleToggleFeature}
        />
        <div className="mt-4">
          <button
            type="button"
            disabled={isLocked(2)}
            onClick={handleStep2Continue}
            className="shell-docs-radius-control inline-flex min-h-9 items-center justify-center border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {featureIds.size > 0 ? "Confirm" : "Skip"}
          </button>
        </div>
      </StepBlock>

      <StepConnector lit={reached >= 3} />

      <StepBlock
        id={STEP_DOM_ID[3]}
        state={stepState(3, backendDone)}
        step={3}
        name="Your agent backend"
        description="Any framework that speaks AG-UI, or CopilotKit's own built-in agent."
        hint={
          isLocked(3)
            ? "Confirm your features first"
            : backendDone
              ? backendName
              : undefined
        }
      >
        <PickGrid
          picks={backends}
          selectedId={backendId ?? undefined}
          disabled={isLocked(3)}
          onSelect={handleSelectBackend}
        />
      </StepBlock>

      {backendId ? (
        <>
          <StepConnector lit={reached >= 4} />

          <StepBlock
            id={STEP_DOM_ID[4]}
            state="active"
            step={4}
            name="Copy your prompt"
            description="The canonical onboarding prompt, with your answers appended so your coding agent does not have to ask again."
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="shell-docs-radius-control inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none"
              >
                {COPY_LABEL[copyState]}
              </button>
              <Link
                href="/quickstart"
                className="text-xs text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-secondary)] hover:underline"
              >
                Prefer to set it up yourself? Follow the manual quickstart.
              </Link>
            </div>
            <span aria-live="polite" className="sr-only">
              {copyState === "copied"
                ? "Prompt copied"
                : copyState === "error"
                  ? "Prompt copy failed. Try again."
                  : ""}
            </span>
          </StepBlock>
        </>
      ) : null}
    </div>
  );
}
