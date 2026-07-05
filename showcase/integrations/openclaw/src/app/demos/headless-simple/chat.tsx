"use client";

/**
 * The whole demo, in one screenful: two hooks turn a plain shell into a
 * working chat. `useAgent` exposes the message log + run state for one
 * agent; `useCopilotKit` runs it. No prebuilt CopilotChat.
 */

import { useState } from "react";
import {
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { Sparkles } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./_components/card";

import { AssistantBubble, UserBubble } from "./message-bubble";
import { Composer } from "./composer";
import { EmptyState } from "./empty-state";
import { TypingIndicator } from "./typing-indicator";

export function Chat() {
  // @region[use-agent-simple]
  // Subscribe to the two updates this UI reacts to: the message log (new
  // user/assistant text) and the run status (drives the typing indicator +
  // disabled composer). agentId MUST be registered in the runtime or useAgent
  // hard-fails with a blank page.
  const { agent } = useAgent({
    agentId: "headless-simple",
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState("");

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || agent.isRunning) return;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    });
    setInput("");
    void copilotkit.runAgent({ agent }).catch((err) => {
      // The Headless Simple demo is the canonical "two hooks, your design
      // system" example users copy-paste as a starting point. Silently
      // swallowing errors here would model broken practice; log so a network
      // failure / runtime error / transport disconnect surfaces in the console.
      console.error("[openclaw:headless-simple] runAgent failed", err);
    });
  };
  // @endregion[use-agent-simple]

  // Render only plain user/assistant text — Simple skips tool/system/etc.
  const visible = agent.messages.flatMap((m) => {
    if (m.role !== "user" && m.role !== "assistant") return [];
    if (typeof m.content !== "string" || m.content.length === 0) return [];
    return [{ id: m.id, role: m.role, content: m.content }];
  });

  const last = visible[visible.length - 1];
  const showTyping = agent.isRunning && (!last || last.role === "user");

  const hasMessages = visible.length > 0;

  return (
    <div className="flex h-screen w-full justify-center bg-neutral-50 p-4 sm:p-6">
      <Card className="flex h-full w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 shadow-2xl shadow-black/10">
        <CardHeader className="border-b border-neutral-200 p-4">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            Headless Chat
          </CardTitle>
          <CardDescription>
            Two hooks, your design system — that&apos;s the whole demo.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {!hasMessages ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <EmptyState onPick={send} />
            </div>
          ) : (
            <div
              data-testid="headless-messages"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
                {/* @region[message-list-simple] */}
                {visible.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} content={m.content} />
                  ) : (
                    <AssistantBubble key={m.id} content={m.content} />
                  ),
                )}
                {/* @endregion[message-list-simple] */}
                {showTyping && <TypingIndicator />}
              </div>
            </div>
          )}

          <div className="border-t border-neutral-200" />

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            disabled={!input.trim() || agent.isRunning}
          />
        </CardContent>
      </Card>
    </div>
  );
}
