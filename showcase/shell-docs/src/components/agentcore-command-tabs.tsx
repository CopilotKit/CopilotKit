"use client";

// <AgentCoreCommandTabs> — framework-aware code-block tabs for AgentCore
// quickstart commands. Built on top of Fumadocs's <Tabs> (via the
// shell-docs <Tabs>/<Tab> wrapper) and <DynamicCodeBlock>, so AgentCore
// commands share the same Shiki-highlighted chrome and copy button as
// every other code block in the docs.
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

import React from "react";
import { Tabs, Tab } from "@/components/docs-tabs";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";

interface AgentCoreCommandTabsProps {
  framework?: "langgraph" | "strands";
  lgCommand: string;
  stCommand: string;
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
          <DynamicCodeBlock lang="bash" code={lgCommand} />
        </Tab>
      )}
      {(framework === "strands" || !framework) && (
        <Tab value="Strands">
          <DynamicCodeBlock lang="bash" code={stCommand} />
        </Tab>
      )}
    </Tabs>
  );
}
