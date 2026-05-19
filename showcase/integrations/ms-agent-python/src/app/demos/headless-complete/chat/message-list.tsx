"use client";

/**
 * Routes each message in `agent.messages` to the appropriate renderer:
 *
 * - `user` → UserBubble (text + multimodal attachment chips)
 * - `assistant` → AssistantBubble + tool-call cards via `useRenderToolCall`
 * - `activity` → ActivityWrapper around the node from
 *   `useRenderActivityMessage` (MCP Apps Excalidraw iframe)
 *
 * `tool` messages carry results that pair with assistant tool calls by
 * `toolCallId` — they are not rendered standalone, but we index them so
 * each tool-call card can be promoted from "running" to "complete".
 *
 * `reasoning` / `system` messages are intentionally hidden — their payload
 * surfaces through the assistant's tool calls and final text.
 */

import React, { useMemo } from "react";
import {
  useRenderActivityMessage,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import type { Message, ToolMessage } from "@copilotkit/shared";
import { ActivityWrapper } from "./message-activity";
import { AssistantBubble } from "./message-assistant";
import { UserBubble } from "./message-user";

export function MessageList({ messages }: { messages: Message[] }) {
  const renderToolCall = useRenderToolCall();
  const { renderActivityMessage } = useRenderActivityMessage();

  // Index tool results by their originating tool-call id so each tool-call
  // card can hand the matching ToolMessage to `useRenderToolCall`.
  // Without this the renderer can't see a result and the card stays in the
  // "in-progress" state forever.
  const toolMessagesByCallId = useMemo(() => {
    const map = new Map<string, ToolMessage>();
    for (const m of messages) {
      if (m.role === "tool" && "toolCallId" in m && m.toolCallId) {
        map.set(m.toolCallId, m as ToolMessage);
      }
    }
    return map;
  }, [messages]);

  return (
    <>
      {messages.map((m) => {
        if (m.role === "user") {
          // Cast through the local input shape — UserBubble accepts a
          // simplified version of the ag-ui content union.
          return (
            <UserBubble
              key={m.id}
              content={m.content as Parameters<typeof UserBubble>[0]["content"]}
            />
          );
        }

        if (m.role === "assistant") {
          const toolCalls =
            "toolCalls" in m && Array.isArray(m.toolCalls) ? m.toolCalls : [];
          return (
            <AssistantBubble
              key={m.id}
              content={typeof m.content === "string" ? m.content : undefined}
            >
              {toolCalls.map((tc) => {
                const toolMessage = toolMessagesByCallId.get(tc.id);
                const node = renderToolCall({
                  toolCall: tc,
                  toolMessage,
                });
                return node ? <div key={tc.id}>{node}</div> : null;
              })}
            </AssistantBubble>
          );
        }

        if (m.role === "activity") {
          const node = renderActivityMessage(m);
          if (!node) return null;
          return <ActivityWrapper key={m.id}>{node}</ActivityWrapper>;
        }

        return null;
      })}
    </>
  );
}
