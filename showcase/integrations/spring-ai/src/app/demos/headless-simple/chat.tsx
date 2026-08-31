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

/**
 * Browser-friendly UUID. `crypto.randomUUID` only exists in secure
 * contexts — the local harness drives this page over plain http
 * (http://spring-ai:10000), where it is undefined and the page throws
 * before the message ever sends. Fall back to a math-based UUIDv4
 * (same pattern as the multimodal demo's generateMessageId).
 */
function generateMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function Chat() {
  // @region[use-agent-simple]
  const { agent } = useAgent({ agentId: "headless-simple" });
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || agent.isRunning) return;
    setError(null);
    agent.addMessage({
      id: generateMessageId(),
      role: "user",
      content: trimmed,
    });
    setInput("");
    void copilotkit.runAgent({ agent }).catch((err) => {
      // The Headless Simple demo is the canonical "two hooks, your
      // design system" example users copy-paste as a starting point.
      // Silently swallowing errors here would model broken practice;
      // log so a network failure / runtime error / transport disconnect
      // surfaces in the console for the developer — and render an
      // inline banner so the end user isn't staring at a frozen UI.
      console.error("[spring-ai:headless-simple] runAgent failed", err);
      setError(err instanceof Error ? err.message : String(err));
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
            </ScrollArea>
          )}

          {error && (
            <div
              data-testid="headless-simple-error"
              role="alert"
              className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </div>
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
