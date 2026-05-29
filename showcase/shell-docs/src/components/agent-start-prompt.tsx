"use client";

// <AgentStartPrompt> — collapsed-by-default pill in the docs hero row that
// reveals a copyable AI onboarding prompt. The prompt instructs the user's
// coding agent to install the CopilotKit skills, use `copilotkit-setup`,
// and ask 4 onboarding questions before scaffolding the project.
//
// Layout contract: this component returns three siblings (pill, body, sr-only
// status). It must be placed inside a `sm:flex-wrap sm:flex-row` container so
// the body's `sm:basis-full` can break onto its own row at >=sm; on mobile the
// parent's `flex-col` stacks them naturally. The pill is `w-full sm:w-auto`
// to align with sibling `w-full sm:w-fit` controls (e.g. HeroQuickstartDropdown)
// on small viewports.

import React from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Sparkles, X } from "lucide-react";

const PROMPT = `Help me get started with CopilotKit — the frontend stack for AI agents and generative UI.

First, install the CopilotKit skills:

  npx skills add CopilotKit/CopilotKit

Then use the \`copilotkit-setup\` skill to guide the setup.

If your agent doesn't support skills, use the CopilotKit MCP server instead:
https://mcp.copilotkit.ai/mcp

Please ask me the following questions one at a time:
1. What framework are you using? (e.g. Next.js, Vite + React, Remix, other)
2. What do you want to name your project?
3. What are you trying to accomplish?
4. Are you starting a new project or integrating CopilotKit into an existing one?

Once you have my answers, use the installed skills to guide me through setup step by step.`;

type CopyState = "idle" | "copied" | "error";

export function AgentStartPrompt() {
  const [expanded, setExpanded] = React.useState(false);
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const bodyId = React.useId();
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copied = copyState === "copied";
  const errored = copyState === "error";

  let copyLabel: string;
  if (copied) copyLabel = "Copied prompt";
  else if (errored) copyLabel = "Copy blocked; select the prompt text manually";
  else copyLabel = "Copy prompt";

  const onCopy = async () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopyState("copied");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      // Clipboard blocked (insecure context, sandboxed iframe, permissions
      // policy, in-app webview, or older browser without navigator.clipboard).
      // Surface the failure visually AND force the panel open so the user can
      // manually select the prompt text — the entire feature is paste-this-
      // into-your-agent, so a silent no-op is a dead-end UX.
      console.warn("[agent-start-prompt] clipboard write failed", err);
      // Force-expand only on the first failure so a user who manually
      // collapsed the panel after the error isn't yanked back open on retry.
      if (copyState !== "error") setExpanded(true);
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2500);
    }
  };

  return (
    <>
      <div className="group flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] sm:w-auto">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Sparkles
            className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <span className="whitespace-nowrap text-[13px] font-medium text-[var(--text)]">
            Start with an agent
          </span>
          <span className="hidden min-w-0 truncate text-[12px] text-[var(--text-muted)] md:inline">
            paste into Claude, Cursor, or any AI coding agent
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copyLabel}
          className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-[var(--bg-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            errored
              ? "border-red-500 text-red-500"
              : "border-[var(--border)] text-[var(--text-muted)] group-hover:text-[var(--accent)]"
          }`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : errored ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div
        id={bodyId}
        hidden={!expanded}
        className="w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] sm:basis-full"
      >
        <pre className="m-0 whitespace-pre-wrap break-words bg-transparent px-4 py-3 font-mono text-[12px] leading-[1.65] text-[var(--text-secondary)]">
          {PROMPT}
        </pre>
        <div className="border-t border-[var(--border)] px-4 py-2 text-[12px]">
          <Link
            href="/build-with-agents"
            prefetch={false}
            className="inline-flex items-center gap-1 rounded text-[var(--accent)] no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:underline"
          >
            Learn more about building with agents
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </div>

      <span aria-live="polite" className="sr-only">
        {copied
          ? "Prompt copied to clipboard"
          : errored
            ? "Clipboard blocked; select the prompt text manually"
            : ""}
      </span>
    </>
  );
}
