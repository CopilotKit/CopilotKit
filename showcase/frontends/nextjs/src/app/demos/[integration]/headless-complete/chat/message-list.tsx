"use client";

/**
 * Routes each message in `agent.messages` to the right renderer:
 *
 * - `user`: UserBubble (text + multimodal attachment chips)
 * - `assistant`: AssistantBubble + tool-call cards via `useRenderToolCall`
 * - `activity`: ActivityWrapper around the node from
 *   `useRenderActivityMessage` (MCP Apps Excalidraw iframe)
 *
 * `tool` messages carry results that pair with assistant tool calls by
 * `toolCallId`. They are not rendered on their own, but they are indexed,
 * so that each tool-call card can move from "running" to "complete".
 *
 * `reasoning` and `system` messages are hidden on purpose: their payload
 * surfaces through the assistant's tool calls and final text.
 */

import React, { useMemo } from "react";
import {
  useRenderActivityMessage,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import type { Message, ToolResult } from "@copilotkit/shared";
import { ActivityWrapper } from "./message-activity";
import { AssistantBubble } from "./message-assistant";
import { UserBubble } from "./message-user";

export function MessageList({ messages }: { messages: Message[] }) {
  // @region[use-rendered-messages-hook]
  const renderToolCall = useRenderToolCall();
  const { renderActivityMessage } = useRenderActivityMessage();

  // Index tool results by the id of the tool call they answer, so that
  // each tool-call card can hand the matching tool message to
  // `useRenderToolCall`. Without it, the renderer sees no result and the
  // card stays "in progress" forever.
  const toolMessagesByCallId = useMemo(() => {
    const map = new Map<string, ToolResult>();
    for (const m of messages) {
      if (m.role === "tool" && m.toolCallId) {
        map.set(m.toolCallId, m);
      }
    }
    return map;
  }, [messages]);
  // @endregion[use-rendered-messages-hook]

  return (
    <>
      {/* @region[manual-activity-message-rendering] */}
      {messages.map((m) => {
        switch (m.role) {
          case "user":
            return <UserBubble key={m.id} content={m.content} />;

          case "assistant": {
            const toolCalls = m.toolCalls ?? [];
            return (
              <AssistantBubble
                key={m.id}
                content={typeof m.content === "string" ? m.content : undefined}
              >
                {/* @region[manual-tool-call-rendering] */}
                {toolCalls.map((tc) => {
                  const toolMessage = toolMessagesByCallId.get(tc.id);
                  const node = renderToolCall({
                    toolCall: tc,
                    toolMessage,
                  });
                  return node ? <div key={tc.id}>{node}</div> : null;
                })}
                {/* @endregion[manual-tool-call-rendering] */}
              </AssistantBubble>
            );
          }

          case "activity": {
            const node = renderActivityMessage(m);
            if (!node) return null;
            return <ActivityWrapper key={m.id}>{node}</ActivityWrapper>;
          }

          default:
            return null;
        }
      })}
      {/* @endregion[manual-activity-message-rendering] */}
    </>
  );
}
