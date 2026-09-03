"use client";

import React from "react";
import { ChevronRight } from "lucide-react";

export const WEBMCP_SETUP_PROMPT =
  "Set up WebMCP in this project using https://docs.copilotkit.ai/webmcp. First inspect the app and extend its existing CopilotKit setup if present; do not add a backend agent solely for WebMCP. If I haven’t specified a tool, ask what I want to expose. If I don’t have one in mind, add a small, read-only demo tool that fits the app. Finish by verifying that a compatible browser can discover and call it.";

type CopyState = "idle" | "copied" | "error";

export function WebMCPSetupPrompt(): React.JSX.Element {
  const promptId = React.useId();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  async function copyPrompt(): Promise<void> {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    try {
      await navigator.clipboard.writeText(WEBMCP_SETUP_PROMPT);
      setCopyState("copied");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2600);
    }
  }

  return (
    <div
      className="shell-docs-radius-surface not-prose my-6 overflow-hidden border border-[var(--nav-control-border)] bg-[var(--bg-surface)] shadow-[var(--shadow-control)]"
      data-docs-copy-surface="docs_webmcp_setup_prompt"
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

        <span className="block text-base leading-relaxed sm:col-start-2">
          Use this pre-built prompt to get WebMCP running faster.
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
            {WEBMCP_SETUP_PROMPT}
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
    </div>
  );
}
