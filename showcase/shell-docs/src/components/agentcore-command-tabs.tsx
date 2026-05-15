"use client";

// <AgentCoreCommandTabs> — framework-aware code-block tabs for AgentCore
// quickstart commands. Ported from the upstream `docs/components/content/`
// version, but rewritten on top of shell-docs's own <Tabs>/<Tab> primitives
// (the upstream component depends on fumadocs-ui, which shell-docs doesn't
// install).
//
// Usage in MDX:
//     <AgentCoreCommandTabs
//       lgCommand="npx copilotkit@latest create -f agentcore-langgraph"
//       stCommand="npx copilotkit@latest create -f agentcore-strands"
//     />
//
// With no `framework` prop the component shows both LangGraph and Strands
// tabs (the canonical shell-docs page lets the user pick). Passing
// `framework="langgraph"` or `framework="strands"` collapses to a single
// tab; we keep that prop for parity with the upstream API even though
// the canonical shell-docs page doesn't use it.
//
// Each command renders inside the same figure chrome that <Snippet> uses
// (figcaption with a copy button + hljs-highlighted bash) so AgentCore
// commands match the visual treatment of every other code block in the
// docs instead of dropping to bare unstyled <pre> output.

import React from "react";
import hljs from "highlight.js";
import { Tabs, Tab } from "@/components/docs-tabs";
import { CopyButton } from "@/components/copy-button";

interface AgentCoreCommandTabsProps {
  framework?: "langgraph" | "strands";
  lgCommand: string;
  stCommand: string;
}

function CommandBlock({ command }: { command: string }) {
  // Highlight inline rather than relying on rehype-highlight (which only
  // runs on MDX code fences, not on hand-rolled JSX). github /
  // github-dark-dimmed themes are loaded globally in app/globals.css, so
  // the `hljs language-bash` className picks up theming automatically.
  let html: string;
  try {
    html = hljs.highlight(command, {
      language: "bash",
      ignoreIllegals: true,
    }).value;
  } catch {
    html = escapeHtml(command);
  }

  return (
    <figure className="my-3 rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
      <figcaption className="flex items-center justify-end px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
        <CopyButton text={command} />
      </figcaption>
      <pre className="text-[12.5px] leading-[1.55] overflow-x-auto p-4 m-0">
        <code
          className="hljs language-bash"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </figure>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function AgentCoreCommandTabs({
  framework,
  lgCommand,
  stCommand,
}: AgentCoreCommandTabsProps) {
  const items =
    framework === "langgraph"
      ? ["LangGraph"]
      : framework === "strands"
        ? ["Strands"]
        : ["LangGraph", "Strands"];

  return (
    <Tabs groupId="agentcore-framework" items={items}>
      {(framework === "langgraph" || !framework) && (
        <Tab value="LangGraph">
          <CommandBlock command={lgCommand} />
        </Tab>
      )}
      {(framework === "strands" || !framework) && (
        <Tab value="Strands">
          <CommandBlock command={stCommand} />
        </Tab>
      )}
    </Tabs>
  );
}
