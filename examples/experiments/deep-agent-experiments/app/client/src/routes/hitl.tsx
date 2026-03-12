import { useMemo, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "react-error-boundary";
import {
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { useLangGraphInterrupt } from "@copilotkit/react-core";

import type { AssistantMessage, Message } from "@ag-ui/core";
import { ReportCanvas } from "../components/ReportCanvas";
import type { ContentBlock } from "../lib/canvas-types";

import "@copilotkit/react-core/v2/styles.css";

export const Route = createFileRoute("/hitl")({
  component: HITLPage,
});

// ---------------------------------------------------------------------------
// Canvas helpers (same as use-agent.tsx)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Interrupt-based HITL types
// ---------------------------------------------------------------------------

interface HITLActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

interface HITLRequest {
  action_requests: HITLActionRequest[];
  review_configs: {
    action_name: string;
    allowed_decisions: string[];
  }[];
}

type ResolveFn = (value: unknown) => void;

// ---------------------------------------------------------------------------
// HITL Interrupt Handler
//
// A single useLangGraphInterrupt hook dispatches to the correct UI based on
// which tool triggered the interrupt. All three HITL tools (select_research_angle,
// confirm_report, search_web) are handled here.
// ---------------------------------------------------------------------------

function HITLInterruptHandler() {
  useLangGraphInterrupt<HITLRequest>({
    render: ({ event, resolve }) => {
      const request = event.value;
      if (!request?.action_requests?.length) return null;

      const action = request.action_requests[0];

      switch (action.name) {
        case "select_research_angle":
          return (
            <ResearchAngleUI
              action={action}
              request={request}
              resolve={resolve}
            />
          );
        case "confirm_report":
          return (
            <ReportConfirmUI
              action={action}
              request={request}
              resolve={resolve}
            />
          );
        case "search_web":
          return (
            <SearchApprovalUI
              action={action}
              request={request}
              resolve={resolve}
            />
          );
        default:
          return null;
      }
    },
  });

  return null;
}

// ---------------------------------------------------------------------------
// Research Angle Selection UI
// ---------------------------------------------------------------------------

function ResearchAngleUI({
  action,
  request,
  resolve,
}: {
  action: HITLActionRequest;
  request: HITLRequest;
  resolve: ResolveFn;
}) {
  const topic =
    typeof action.args.topic === "string" ? action.args.topic : "";
  const options = Array.isArray(action.args.options)
    ? (action.args.options as string[])
    : [];

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
        Waiting for research angles...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
      <h4 className="mb-1 text-sm font-semibold text-gray-900">
        Choose a research angle
      </h4>
      {topic && (
        <p className="mb-3 text-xs text-gray-500">Topic: {topic}</p>
      )}
      <div className="flex flex-col gap-2">
        {options.map((option, i) => (
          <button
            key={i}
            onClick={() =>
              resolve({
                decisions: request.action_requests.map(() => ({
                  type: "reject" as const,
                  message: `User selected research angle: ${option}`,
                })),
              })
            }
            className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm hover:border-blue-300 hover:bg-blue-50"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Confirmation UI
// ---------------------------------------------------------------------------

function ReportConfirmUI({
  action,
  request,
  resolve,
}: {
  action: HITLActionRequest;
  request: HITLRequest;
  resolve: ResolveFn;
}) {
  const summary =
    typeof action.args.summary === "string" ? action.args.summary : "";

  return (
    <div className="rounded-lg border border-yellow-200 bg-white p-4 shadow-sm">
      <h4 className="mb-2 text-sm font-semibold text-gray-900">
        Confirm report
      </h4>
      <p className="mb-3 text-sm text-gray-700 whitespace-pre-wrap">
        {summary}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() =>
            resolve({
              decisions: request.action_requests.map(() => ({
                type: "approve" as const,
              })),
            })
          }
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          Publish to canvas
        </button>
        <button
          onClick={() =>
            resolve({
              decisions: request.action_requests.map(() => ({
                type: "reject" as const,
                message:
                  "User rejected the report. Please revise the findings.",
              })),
            })
          }
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Request changes
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Approval UI
// ---------------------------------------------------------------------------

function SearchApprovalUI({
  action,
  request,
  resolve,
}: {
  action: HITLActionRequest;
  request: HITLRequest;
  resolve: ResolveFn;
}) {
  const query =
    typeof action.args?.query === "string"
      ? action.args.query
      : JSON.stringify(action.args);

  return (
    <div className="rounded-lg border border-orange-200 bg-white p-4 shadow-sm">
      <h4 className="mb-1 text-sm font-semibold text-gray-900">
        Search approval required
      </h4>
      <p className="mb-3 text-sm text-gray-600">
        The agent wants to search the web for:
      </p>
      <div className="mb-3 rounded-md bg-gray-50 px-3 py-2 text-sm font-mono text-gray-800">
        {query}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() =>
            resolve({
              decisions: request.action_requests.map(() => ({
                type: "approve" as const,
              })),
            })
          }
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Approve search
        </button>
        <button
          onClick={() =>
            resolve({
              decisions: request.action_requests.map(() => ({
                type: "reject" as const,
                message:
                  "User rejected this search. Try a different query.",
              })),
            })
          }
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Canvas (reads messages and renders content blocks)
// ---------------------------------------------------------------------------

function AgentCanvas() {
  const { agent } = useAgent({
    agentId: "research_agent_hitl",
    updates: [UseAgentUpdate.OnMessagesChanged],
  });

  const blocks = useMemo(
    () => messagesToBlocks(agent.messages),
    [agent.messages],
  );

  return <ReportCanvas blocks={blocks} />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function HITLPage() {
  return (
    <ErrorBoundary fallback="something went wrong">
      <Suspense fallback="loading">
        <CopilotKit runtimeUrl="/api/copilot" agent="research_agent_hitl">
          <div className="relative flex h-full w-full overflow-hidden">
            <div className="flex-1 relative">
              {/* Single interrupt handler for all HITL interactions */}
              <HITLInterruptHandler />

              {/* Canvas + Sidebar */}
              <AgentCanvas />
              <CopilotSidebar
                agentId="research_agent_hitl"
                defaultOpen={true}
                labels={{
                  modalHeaderTitle: "Research Assistant (HITL)",
                  welcomeMessageText:
                    "Hi! I'm your research agent with human-in-the-loop. You'll be able to choose research angles, approve web searches, and confirm reports before they're published. What topic should we research?",
                }}
              />
            </div>
          </div>
        </CopilotKit>
      </Suspense>
    </ErrorBoundary>
  );
}
