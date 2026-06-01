"use client";

import { Tabs, Tab } from "fumadocs-ui/components/tabs";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

interface AgentCoreCommandTabsProps {
  framework?: "langgraph" | "strands";
  lgCommand: string;
  stCommand: string;
}

/**
 * Renders a framework-aware Tabs code block.
 * - No framework: shows both LangGraph and Strands tabs.
 * - framework="langgraph": shows only the LangGraph tab.
 * - framework="strands": shows only the Strands tab.
 */
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
          <CodeBlock data-language="bash">
            <Pre>
              <code className="language-bash ml-4"> {lgCommand}</code>
            </Pre>
          </CodeBlock>
        </Tab>
      )}
      {(framework === "strands" || !framework) && (
        <Tab value="Strands">
          <CodeBlock data-language="bash">
            <Pre>
              <code className="language-bash ml-4">{stCommand}</code>
            </Pre>
          </CodeBlock>
        </Tab>
      )}
    </Tabs>
  );
}
