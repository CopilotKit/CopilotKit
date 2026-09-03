"use client";

import React from "react";
import { ChevronRight } from "lucide-react";

export const WEBMCP_SETUP_PROMPT =
  "Set up WebMCP in this project using https://docs.copilotkit.ai/webmcp. First inspect the app and extend its existing CopilotKit setup if present; do not add a backend agent solely for WebMCP. If I haven’t specified a tool, ask what I want to expose. If I don’t have one in mind, add a small, read-only demo tool that fits the app. Finish by verifying that a compatible browser can discover and call it.";

type CopyState = "idle" | "copied" | "error";

export function WebMCPSetupPrompt(): React.JSX.Element {
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
      className="shell-docs-radius-surface not-prose my-6 flex flex-col gap-4 border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 shadow-[var(--shadow-control)] sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      data-docs-copy-surface="docs_webmcp_setup_prompt"
    >
      <div className="flex min-w-0 items-center gap-3 text-[var(--text-secondary)]">
        <ChevronRight
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-[var(--text-muted)]"
        />
        <p className="m-0 text-base leading-relaxed">
          Use this pre-built prompt to get WebMCP running faster.
        </p>
      </div>

      <button
        type="button"
        onClick={copyPrompt}
        className="shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center bg-[var(--text)] px-5 text-sm font-semibold text-[var(--bg)] transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto"
      >
        {copyState === "copied"
          ? "Copied"
          : copyState === "error"
            ? "Copy blocked"
            : "Copy prompt"}
      </button>

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
