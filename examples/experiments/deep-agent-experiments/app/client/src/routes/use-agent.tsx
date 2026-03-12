import { useMemo, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "react-error-boundary";
import {
  // CopilotKitProvider,
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

import type { AssistantMessage, Message } from "@ag-ui/core";
import { ReportCanvas } from "../components/ReportCanvas";
import type { ContentBlock } from "../lib/canvas-types";

import "@copilotkit/react-core/v2/styles.css";

export const Route = createFileRoute("/use-agent")({
  component: UseAgentPage,
});

function messagesToBlocks(messages: Message[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let blockId = 0;

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;

      if (assistantMsg.content) {
        blocks.push({
          id: `msg-text-${blockId++}`,
          type: "markdown",
          content: assistantMsg.content,
        });
      }

      if (assistantMsg.toolCalls) {
        for (const tc of assistantMsg.toolCalls) {
          const args = safeParseArgs(tc.function.arguments);
          const toolName = tc.function.name;

          if (toolName === "canvas_markdown" && args.content) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "markdown",
              content: args.content,
            });
          } else if (toolName === "canvas_chart" && args.title) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "chart",
              title: args.title,
              chartType: args.chartType ?? "bar",
              labels: args.labels ?? [],
              values: args.values ?? [],
            });
          } else if (toolName === "canvas_table" && args.title) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "table",
              title: args.title,
              headers: args.headers ?? [],
              rows: args.rows ?? [],
            });
          } else if (toolName === "canvas_code" && args.code) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "code",
              language: args.language ?? "text",
              code: args.code,
              filename: args.filename,
            });
          }
        }
      }
    }
  }

  const lastClearIndex = findLastClearIndex(blocks, messages);
  return lastClearIndex >= 0 ? blocks.slice(lastClearIndex) : blocks;
}

function findLastClearIndex(blocks: ContentBlock[], messages: Message[]): number {
  let lastClearTcId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const am = msg as AssistantMessage;
      if (am.toolCalls) {
        for (const tc of am.toolCalls) {
          if (tc.function.name === "canvas_clear") {
            lastClearTcId = tc.id;
            break;
          }
        }
      }
    }
    if (lastClearTcId) break;
  }

  if (!lastClearTcId) return -1;

  const clearBlockIdx = blocks.findIndex((b) => b.id === `tc-${lastClearTcId}`);
  return clearBlockIdx >= 0 ? clearBlockIdx + 1 : -1;
}

function safeParseArgs(argsStr: string): Record<string, any> {
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
}

function AgentCanvas() {
  const { agent } = useAgent({
    agentId: "research_agent",
    updates: [UseAgentUpdate.OnMessagesChanged],
  });

  const blocks = useMemo(() => messagesToBlocks(agent.messages), [agent.messages]);

  return <ReportCanvas blocks={blocks} />;
}

function UseAgentPage() {
  return (
    <ErrorBoundary fallback="something went wrong">
      <Suspense fallback="loading">
        {/* <CopilotKitProvider runtimeUrl="/api/copilot" useSingleEndpoint> */}
        <CopilotKit runtimeUrl="/api/copilot" agent="research_agent">
          <div className="relative flex h-full w-full overflow-hidden">
            <div className="flex-1 relative">
              <AgentCanvas />
              <CopilotSidebar
                agentId="research_agent"
                defaultOpen={true}
                labels={{
                  modalHeaderTitle: "Research Assistant",
                  welcomeMessageText:
                    "Hi! I'm your Deep Agent. What topic should we research today?",
                }}
              />
            </div>
          </div>
        </CopilotKit>
        {/* </CopilotKitProvider> */}
      </Suspense>
    </ErrorBoundary>
  );
}
