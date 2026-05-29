"use client";

// <AgentStartPrompt> — collapsed-by-default pill in the docs hero row that
// reveals a copyable AI onboarding prompt. The prompt instructs the user's
// coding agent to install the CopilotKit skills, use `copilotkit-setup`,
// and ask 4 onboarding questions before scaffolding the project.

import React from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Sparkles } from "lucide-react";

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

export function AgentStartPrompt() {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
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

  const onCopy = async () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("[agent-start-prompt] clipboard write failed", err);
    }
  };

  return (
    <>
      <div className="group flex h-11 min-w-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
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
          aria-label={copied ? "Copied prompt" : "Copy prompt"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div
          id={bodyId}
          className="w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] sm:basis-full"
        >
          <pre className="m-0 whitespace-pre-wrap break-words bg-transparent px-4 py-3 font-mono text-[12px] leading-[1.65] text-[var(--text-secondary)]">
            {PROMPT}
          </pre>
          <div className="border-t border-[var(--border)] px-4 py-2 text-[12px]">
            <Link
              href="/build-with-agents"
              className="inline-flex items-center gap-1 text-[var(--accent)] no-underline"
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
      )}
    </>
  );
}
