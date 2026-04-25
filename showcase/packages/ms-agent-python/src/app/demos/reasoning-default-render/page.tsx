"use client";

// Reasoning (Default Render) demo.
//
// The LangGraph reference demonstrates CopilotKit's built-in
// `CopilotChatReasoningMessage` slot rendering AG-UI REASONING_MESSAGE_*
// events with zero config.
//
// The Microsoft Agent Framework AG-UI bridge doesn't currently emit those
// events. To show the equivalent default experience, the backend calls a
// `think` tool that the frontend renders with a minimal built-in-style
// collapsible card — the closest MS Agent equivalent to the stock
// `CopilotChatReasoningMessage` render.

import React, { useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="reasoning-default-render"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <Chat />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useRenderTool({
    name: "think",
    parameters: z.object({ thought: z.string() }),
    render: ({ args, status }: any) => (
      <DefaultReasoningMessage thought={args?.thought ?? ""} status={status} />
    ),
  });

  return (
    <CopilotChat
      agentId="reasoning-default-render"
      className="h-full rounded-2xl"
    />
  );
}

// Mirrors CopilotKit's built-in CopilotChatReasoningMessage UX: a
// collapsible "Thinking…" / "Thought for a moment" card.
function DefaultReasoningMessage({
  thought,
  status,
}: {
  thought: string;
  status?: string;
}) {
  const isStreaming = status !== "complete";
  const [open, setOpen] = useState(isStreaming);
  const hasContent = thought.length > 0;

  return (
    <div
      data-testid="reasoning-default"
      style={{
        margin: "8px 0",
        borderRadius: "12px",
        border: "1px solid var(--copilot-kit-separator-color, #e5e7eb)",
        background: "var(--copilot-kit-secondary-color, #f9fafb)",
        padding: "8px 12px",
        fontSize: "13px",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontWeight: 500,
          color: "var(--copilot-kit-muted-color, #4b5563)",
        }}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span>{isStreaming ? "Thinking…" : "Thought for a moment"}</span>
      </button>
      {open && hasContent && (
        <div
          style={{
            marginTop: "6px",
            whiteSpace: "pre-wrap",
            color: "var(--copilot-kit-muted-color, #6b7280)",
          }}
        >
          {thought}
        </div>
      )}
    </div>
  );
}
