/**
 * Scenario: Frontend action lost on thread reconnect (the bug)
 *
 * This version uses v2 CopilotKit components directly (bypassing v1 bridge)
 * to isolate the rendering issue from the v1→v2 bridge.
 *
 * Steps to reproduce:
 *   1. Send "support" → agent responds with text + calls get_help frontend tool
 *   2. The "Get Help" button renders in the chat via useFrontendTool render
 *   3. Click "Disconnect" → unmounts CopilotKit (simulates navigating away)
 *   4. Click "Reconnect" → remounts CopilotKit with the SAME threadId
 *   5. Bug: button disappears on reconnect
 */

import { useState, useId, useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { TAG } from "./lib";

import "@copilotkit/react-core/v2/styles.css";

function GetHelpRender({ status, args }: any) {
  const topic = args?.topic ?? "unknown";
  console.log(TAG, "[broken] get_help render, status:", status, "topic:", topic);
  return (
    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg my-2">
      <p className="text-sm text-blue-800 mb-2">
        {status !== "complete" && "Loading help..."}
        {status === "complete" && (
          <>
            Help requested: <strong>{topic}</strong>
          </>
        )}
      </p>
      <button
        onClick={() => {
          console.log(TAG, "[broken] Get Help button clicked for:", topic);
          alert(`Help topic: ${topic}`);
        }}
        className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700"
      >
        Get Help: {topic}
      </button>
    </div>
  );
}

function MessageDebugger() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: "default" });
  const messages = agent?.messages ?? [];
  const tools = copilotkit?.tools ?? [];
  const renderToolCalls = copilotkit?.renderToolCalls ?? [];

  // Log to console on every change
  useEffect(() => {
    console.log(TAG, "[debug] === Message state ===");
    console.log(TAG, "[debug] messages count:", messages.length);
    console.log(
      TAG,
      "[debug] registered tools:",
      tools.map((t: any) => ({ name: t.name, hasRender: !!t.render })),
    );
    console.log(
      TAG,
      "[debug] renderToolCalls:",
      renderToolCalls.map((r: any) => r.name),
    );
    messages.forEach((m: any, i: number) => {
      const tc = m.toolCalls;
      console.log(
        TAG,
        `[debug] msg[${i}] role=${m.role} id=${m.id?.slice(0, 12)} toolCalls=${
          tc
            ? JSON.stringify(
                tc.map((t: any) => ({
                  id: t.id?.slice(0, 8),
                  name: t.function?.name,
                })),
              )
            : "undefined"
        } content=${(m.content || "").slice(0, 60)}`,
      );
    });
  }, [messages, tools, renderToolCalls]);

  // Visual diagnostic overlay — shows whether messages have toolCalls
  const toolCallMessages = messages.filter(
    (m: any) => m.role === "assistant" && m.toolCalls?.length > 0,
  );

  return (
    <div className="fixed bottom-2 left-2 z-[9999] max-w-xs bg-black/90 text-white text-[10px] font-mono p-2 rounded shadow-lg pointer-events-none">
      <div>msgs: {messages.length} | tools: {tools.length} | renders: {renderToolCalls.length}</div>
      {toolCallMessages.map((m: any, i: number) => (
        <div key={i} className="mt-1 text-green-300">
          assistant has toolCalls: {m.toolCalls.map((tc: any) => tc.function?.name).join(", ")}
        </div>
      ))}
      {messages.length > 0 && toolCallMessages.length === 0 && (
        <div className="mt-1 text-red-300">NO toolCalls on any assistant message</div>
      )}
    </div>
  );
}

// Tool definition as a stable array for the frontendTools prop.
// Using props instead of useFrontendTool avoids a CopilotKitProvider bug
// where its didMountRef guard fails under React Strict Mode, causing
// setRenderToolCalls([]) to overwrite the hook's registration.
const getHelpTool = {
  name: "get_help",
  description: "Get help on a specific topic. Renders a button in the chat.",
  parameters: z.object({
    topic: z.string().describe("The topic to get help on"),
  }),
  handler: async (args: any) => {
    console.log(TAG, "[broken] get_help handler called, topic:", args.topic);
    return `Help provided for: ${args.topic}`;
  },
  render: GetHelpRender,
};
const FRONTEND_TOOLS = [getHelpTool];

export default function ScenarioBroken() {
  const stableId = useId();
  const [threadId] = useState(() => `tkt-reconnect-${stableId}-${Date.now()}`);
  const [connected, setConnected] = useState(true);

  console.log(TAG, "[broken] ScenarioBroken render, connected:", connected, "threadId:", threadId);

  return (
    <div>
      <div className="flex items-center gap-3 p-3 bg-amber-50 border-b border-amber-200">
        <span className="text-xs font-mono text-amber-800 truncate">Thread: {threadId}</span>
        <div className="flex gap-2 ml-auto shrink-0">
          {connected ? (
            <button
              onClick={() => {
                console.log(TAG, "[broken] Disconnecting (unmounting CopilotKit)");
                setConnected(false);
              }}
              className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => {
                console.log(
                  TAG,
                  "[broken] Reconnecting (remounting CopilotKit with same threadId)",
                );
                setConnected(true);
              }}
              className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-700">
        <strong>Bug scenario:</strong> Send "support" to trigger the get_help frontend tool. A "Get
        Help" button should render in the sidebar chat. Then click <strong>Disconnect</strong> →{" "}
        <strong>Reconnect</strong> to simulate returning to the thread.
      </div>

      {connected ? (
        <CopilotKit
          runtimeUrl="/api/tickets/tkt-reconnect-lost-actions/copilot"
          agent="default"
          useSingleEndpoint
          frontendTools={FRONTEND_TOOLS}
        >
          <MessageDebugger />
          <CopilotSidebar defaultOpen={true} agentId="default" threadId={threadId} />
        </CopilotKit>
      ) : (
        <div className="flex items-center justify-center h-[500px] bg-gray-100 text-gray-500 text-sm">
          Disconnected — click "Reconnect" to rejoin the same thread
        </div>
      )}
    </div>
  );
}
