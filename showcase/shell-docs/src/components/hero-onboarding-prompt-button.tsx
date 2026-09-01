"use client";

// <HeroOnboardingPromptButton> — the compact hero twin of
// <IntelligenceOnboardingPrompt>. Same prompt, same run id, same PostHog event
// and property names, so the hero placement and the in-page section land in one
// comparable funnel instead of two that cannot be joined.

import React from "react";
import { Copy } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";

type CopyState = "idle" | "copied" | "error";

const IDLE_LABEL = "Copy onboarding prompt";

export interface HeroOnboardingPromptButtonProps {
  surface: string;
}

export function HeroOnboardingPromptButton({
  surface,
}: HeroOnboardingPromptButtonProps): React.JSX.Element {
  const pathname = usePathname();
  const posthog = usePostHog();
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Each click claims a generation so a slow clipboard promise from an earlier
  // click can never resurrect its state after a newer click or after unmount.
  const copyGenerationRef = React.useRef(0);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyGenerationRef.current += 1;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    };
  }, []);

  function isCurrent(generation: number): boolean {
    return mountedRef.current && generation === copyGenerationRef.current;
  }

  function scheduleReset(generation: number, delayMs: number): void {
    resetTimerRef.current = setTimeout(() => {
      if (isCurrent(generation)) {
        setCopyState("idle");
        resetTimerRef.current = null;
      }
    }, delayMs);
  }

  async function copyPrompt(): Promise<void> {
    const generation = (copyGenerationRef.current += 1);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setCopyState("idle");

    const runId = createOnboardingRunId();

    try {
      await navigator.clipboard.writeText(
        createIntelligenceOnboardingPrompt(runId),
      );
    } catch {
      if (!isCurrent(generation)) return;
      setCopyState("error");
      scheduleReset(generation, 2600);
      return;
    }

    if (!isCurrent(generation)) return;
    setCopyState("copied");

    try {
      posthog?.capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
        from_path: pathname,
        onboarding_run_id: runId,
        surface,
      });
    } catch {
      // Analytics must never break the copy interaction.
    }

    scheduleReset(generation, 1800);
  }

  return (
    <>
      <button
        type="button"
        onClick={copyPrompt}
        data-surface={surface}
        className="shell-docs-primary-cta shell-docs-radius-control inline-flex h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-fit"
      >
        <Copy aria-hidden="true" className="h-4 w-4" />
        {/* The status labels are far shorter than the idle one, so rendering
            only the active label collapses this button and shunts the
            Quickstart button beside it sideways mid-interaction. Stack all
            labels in one grid cell and keep the longest one in the layout
            (invisible) so the width is reserved without a magic pixel value. */}
        <span className="grid">
          <span
            aria-hidden="true"
            className="invisible col-start-1 row-start-1"
          >
            {IDLE_LABEL}
          </span>
          <span className="col-start-1 row-start-1">
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy blocked"
                : IDLE_LABEL}
          </span>
        </span>
      </button>

      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </>
  );
}
