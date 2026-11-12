// <AgentCoreCommandTabs lgCommand="..." stCommand="..." />: AgentCore's
// commands for LangGraph and for Strands as tabs, collapsed to one tab when
// the framework is known. A port of shell-docs' agentcore-command-tabs.tsx.

import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { DocsCode } from "../code";
import type { DocsScope } from "../scope";

type AgentCoreFramework = "langgraph" | "strands";

/** `langgraph-python` and friends are LangGraph; `strands-typescript`, Strands. */
function agentCoreFramework(
  framework: string | null | undefined,
): AgentCoreFramework | undefined {
  if (!framework) return undefined;
  if (framework.startsWith("langgraph")) return "langgraph";
  if (framework.startsWith("strands") || framework === "aws-strands") {
    return "strands";
  }
  return undefined;
}

export function AgentCoreCommandTabs({
  scope,
  framework,
  lgCommand,
  stCommand,
}: {
  scope: DocsScope;
  /** `langgraph` or `strands` (from a `<Content framework>` partial). */
  framework?: string;
  lgCommand: string;
  stCommand: string;
}) {
  const only = agentCoreFramework(framework ?? scope.framework);
  const tabs = [
    { label: "LangGraph", id: "langgraph", command: lgCommand },
    { label: "Strands", id: "strands", command: stCommand },
  ].filter((t) => !only || t.id === only);

  return (
    <Tabs groupId="agentcore-framework" items={tabs.map((t) => t.label)}>
      {tabs.map((t) => (
        <Tab key={t.id} value={t.label}>
          <DocsCode code={t.command} lang="bash" className="my-0" />
        </Tab>
      ))}
    </Tabs>
  );
}
