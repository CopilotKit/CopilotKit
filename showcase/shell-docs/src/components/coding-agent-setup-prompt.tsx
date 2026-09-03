"use client";

import React from "react";
import { ChevronRight } from "lucide-react";

type CopyState = "idle" | "copied" | "error";

export interface CodingAgentSetupPromptProps {
  /** Short task-specific copy shown in the collapsed prompt row. */
  summary: string;
  /** Full prompt copied to the clipboard and revealed on demand. */
  prompt: string;
  /** Stable analytics identifier for the page that owns this prompt. */
  copySurface: string;
}

/** Shared expandable prompt card for docs setup flows driven by coding agents. */
export function CodingAgentSetupPrompt({
  summary,
  prompt,
  copySurface,
}: CodingAgentSetupPromptProps): React.JSX.Element {
  const summaryId = React.useId();
  const promptId = React.useId();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  async function copyPrompt(): Promise<void> {
    const generation = (copyGenerationRef.current += 1);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setCopyState("idle");

    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      if (!mountedRef.current || generation !== copyGenerationRef.current) {
        return;
      }
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => {
        if (mountedRef.current && generation === copyGenerationRef.current) {
          setCopyState("idle");
          resetTimerRef.current = null;
        }
      }, 2600);
      return;
    }

    if (!mountedRef.current || generation !== copyGenerationRef.current) {
      return;
    }
    setCopyState("copied");
    resetTimerRef.current = setTimeout(() => {
      if (mountedRef.current && generation === copyGenerationRef.current) {
        setCopyState("idle");
        resetTimerRef.current = null;
      }
    }, 1800);
  }

  return (
    <section
      aria-labelledby={summaryId}
      className="shell-docs-radius-surface not-prose my-6 overflow-hidden border border-[var(--nav-control-border)] bg-[var(--bg-surface)] shadow-[var(--shadow-control)]"
      data-docs-copy-surface={copySurface}
    >
      <div className="grid min-h-17 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 p-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:pr-4">
        <button
          type="button"
          aria-controls={promptId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="shell-docs-radius-control inline-flex h-11 w-11 cursor-pointer items-center justify-center border border-[var(--nav-control-border)] bg-[var(--accent-dim)] text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-light)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none sm:col-start-1"
        >
          <ChevronRight
            aria-hidden="true"
            className={`h-5 w-5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
          />
          <span className="sr-only">
            {isExpanded ? "Hide prompt text" : "Show prompt text"}
          </span>
        </button>

        <span
          id={summaryId}
          className="block text-base leading-relaxed sm:col-start-2"
        >
          {summary}
        </span>

        <button
          type="button"
          onClick={copyPrompt}
          className="shell-docs-radius-control col-span-2 inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center border border-[var(--accent)] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:col-span-1 sm:col-start-3 sm:w-auto"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy blocked"
              : "Copy prompt"}
        </button>
      </div>

      {isExpanded && (
        <div
          id={promptId}
          className="border-t border-[var(--nav-control-border)] bg-[var(--accent-dim)] px-5 py-4"
        >
          <div className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-[var(--text-secondary)]">
            {prompt}
          </div>
        </div>
      )}

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
