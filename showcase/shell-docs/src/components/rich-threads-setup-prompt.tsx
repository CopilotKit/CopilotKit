"use client";

import React from "react";
import { Copy, SquareTerminal } from "lucide-react";
import { RICH_THREADS_SETUP_PROMPT } from "@/lib/rich-threads-setup-prompt";

export { RICH_THREADS_SETUP_PROMPT } from "@/lib/rich-threads-setup-prompt";

type CopyState = "idle" | "copied" | "error";

/** Copies the Inspector recovery prompt from the Runtime endpoints guide. */
export function RichThreadsSetupPrompt(): React.JSX.Element {
  const titleId = React.useId();
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
      await navigator.clipboard.writeText(RICH_THREADS_SETUP_PROMPT);
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
      aria-labelledby={titleId}
      className="shell-docs-radius-surface not-prose my-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-control)]"
      data-docs-copy-surface="docs_rich_threads_setup_agent_prompt"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SquareTerminal
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
          />
          <div className="min-w-0">
            <p id={titleId} className="m-0 font-semibold text-[var(--text)]">
              Finish setup with your coding agent
            </p>
            <p className="mt-1 mb-0 max-w-[62ch] text-sm leading-relaxed text-[var(--text-muted)]">
              Copy this prompt. Your agent will inspect your app, make the
              required Runtime changes, and verify Rich Threads.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={copyPrompt}
          className="shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto"
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy blocked"
              : "Copy prompt"}
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
