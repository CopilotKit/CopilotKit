"use client";
import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import { ToolRenderers } from "./tool-renderers";

export default function Page() {
  return <main>
    <header>
      <p className="eyebrow">CopilotKit × Parallel</p>
      <h1>Research with sources</h1>
      <p>Ask a question, discover relevant pages, and follow the evidence.</p>
      <p className="notice">This demo uses Parallel for web search and page extraction. Search queries, URLs, and task context included in tool calls are sent to Parallel. Avoid sensitive information.</p>
    </header>
    <CopilotKit runtimeUrl="/api/copilotkit" agent="default">
      <ToolRenderers />
      <CopilotChat agentId="default" />
    </CopilotKit>
  </main>;
}
