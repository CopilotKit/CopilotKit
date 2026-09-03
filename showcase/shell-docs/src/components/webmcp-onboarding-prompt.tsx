"use client";

import React from "react";
import { Copy, SquareTerminal } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";
import { createWebMCPOnboardingPrompt } from "@/lib/webmcp-onboarding-prompt";

const COPY_SURFACE = "docs_webmcp_onboarding_prompt";

type CopyState = "idle" | "copied" | "error";

/** Copyable WebMCP goal that enters the repository-aware CLI onboarding flow. */
export function WebMCPOnboardingPrompt(): React.JSX.Element {
  const titleId = React.useId();
  const pathname = usePathname();
  const posthog = usePostHog();
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const [isCopying, setIsCopying] = React.useState(false);
  const copyInFlightRef = React.useRef(false);
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mountedRef = React.useRef(true);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  function scheduleReset(delayMs: number): void {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopyState("idle");
      resetTimerRef.current = null;
    }, delayMs);
  }

  async function copyPrompt(): Promise<void> {
    if (copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    setIsCopying(true);
    const runId = createOnboardingRunId();

    try {
      await navigator.clipboard.writeText(createWebMCPOnboardingPrompt(runId));
    } catch {
      if (mountedRef.current) {
        setCopyState("error");
        scheduleReset(2600);
      }
      return;
    } finally {
      copyInFlightRef.current = false;
      if (mountedRef.current) setIsCopying(false);
    }

    if (!mountedRef.current) return;
    setCopyState("copied");
    scheduleReset(1800);

    try {
      posthog?.capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
        from_path: pathname,
        onboarding_run_id: runId,
        surface: COPY_SURFACE,
      });
    } catch {
      // Analytics must never change the result of a successful clipboard write.
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="shell-docs-radius-surface not-prose my-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-control)]"
      data-docs-copy-surface={COPY_SURFACE}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SquareTerminal
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
          />
          <div className="min-w-0">
            <p id={titleId} className="m-0 font-semibold text-[var(--text)]">
              Add WebMCP with your coding agent
            </p>
            <p className="mt-1 mb-0 max-w-[62ch] text-sm leading-relaxed text-[var(--text-muted)]">
              It inspects your app first, then reuses an existing CopilotKit
              tool or wraps the smallest suitable browser action. WebMCP calls
              do not run through a backend agent.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isCopying}
          onClick={copyPrompt}
          className="shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 sm:w-auto"
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {isCopying
            ? "Copying…"
            : copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy blocked"
              : "Copy setup prompt"}
        </button>
      </div>

      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </section>
  );
}
