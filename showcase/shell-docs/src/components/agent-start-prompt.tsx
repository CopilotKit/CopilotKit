"use client";

// <AgentStartPrompt> — copyable AI onboarding prompt for the docs landing page.
// Instructs the AI agent to install CopilotKit skills, use copilotkit-setup,
// and ask the user 4 onboarding questions before scaffolding the project.

import React from "react";
import Link from "next/link";
import { CopyButton } from "./copy-button";

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
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--text-muted)", flexShrink: 0 }}
            aria-hidden="true"
          >
            <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" />
            <path d="M12 8v4l3 3" />
          </svg>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--text)",
            }}
          >
            Start with an agent
          </span>
          <span
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
            }}
          >
            — paste this prompt into Claude, Cursor, or any AI coding agent
          </span>
        </div>
        <CopyButton text={PROMPT} />
      </div>

      {/* Prompt body */}
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: "12px",
          lineHeight: 1.65,
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "transparent",
        }}
      >
        {PROMPT}
      </pre>

      {/* Footer */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          fontSize: "12px",
        }}
      >
        <Link
          href="/build-with-agents"
          style={{
            color: "var(--accent)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          Set up the CopilotKit MCP server
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
  );
}
