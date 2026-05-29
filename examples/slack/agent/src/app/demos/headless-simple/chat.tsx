"use client";

/**
 * The whole demo, in one screenful: two hooks turn a shadcn shell into a
 * working chat. `useAgent` exposes the message log + run state for one
 * agent; `useCopilotKit` runs it.
 */

import { useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { Sparkles } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { AssistantBubble, UserBubble } from "./message-bubble";
import { Composer } from "./composer";
import { EmptyState } from "./empty-state";
import { TypingIndicator } from "./typing-indicator";

export function Chat() {
  const { agent } = useAgent({ agentId: "headless-simple" });
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
    void copilotkit.runAgent({ agent }).catch(() => {});
  };

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
    <div className="flex h-screen w-full justify-center bg-background p-4 sm:p-6">
      <Card className="flex h-full w-full max-w-3xl flex-col gap-0 overflow-hidden border-border py-0 shadow-2xl shadow-black/10">
        <CardHeader className="border-b border-border/60 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Headless Chat
          </CardTitle>
          <CardDescription>
            Two hooks, your design system — that&apos;s the whole demo.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {!hasMessages ? (
            // Render empty state OUTSIDE ScrollArea so flex-1 + justify-
            // center can vertically center it. Radix ScrollArea wraps
            // content in a `display: table` div that breaks `h-full`
            // propagation, so a centered child inside it hugs the top.
            <div className="flex min-h-0 flex-1 flex-col">
              <EmptyState onPick={send} />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
                {visible.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} content={m.content} />
                  ) : (
                    <AssistantBubble key={m.id} content={m.content} />
                  ),
                )}
                {showTyping && <TypingIndicator />}
              </div>
            </ScrollArea>
          )}

          <Separator className="bg-border/60" />

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
