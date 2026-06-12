"use client";

/**
 * Hand-rolled chat shell.
 *
 * Owns the read/write loop:
 * - `useAgent`        — message list, isRunning, addMessage, abortRun, setMessages
 * - `useCopilotKit`   — `runAgent({ agent })` to dispatch a turn
 *
 * Renders the message tree via `<MessageList />` (which uses
 * `useRenderToolCall` and `useRenderActivityMessage` internally), shows
 * a typing indicator while the agent is thinking, and composes the
 * suggestion bar + composer (with attachments) at the bottom.
 *
 * The visual chrome is identical to `headless-simple/chat.tsx` — same
 * outer wrapper, same `Card` shell, same bubble palette — so the two
 * demos read as a pair.
 */

import React, { useCallback, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import type { Attachment, InputContent } from "@copilotkit/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useAttachmentsConfig } from "../attachments/use-attachments-config";
import { useAutoScroll } from "../hooks/use-auto-scroll";
import { useTypingIndicator } from "../hooks/use-typing-indicator";
import { Composer } from "./composer";
import { EmptyState } from "./empty-state";
import { Header } from "./header";
import { MessageList } from "./message-list";
import { SuggestionBar } from "./suggestion-bar";
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

export function Chat({ agentId }: { agentId: string }) {
  // @region[page-send-message]
  const { agent } = useAgent({ agentId });
  const { copilotkit } = useCopilotKit();

  const {
    attachments,
    fileInputRef,
    containerRef,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    dragOver,
    removeAttachment,
    consumeAttachments,
  } = useAttachmentsConfig();

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messages = agent.messages;
  const { listRef, bottomRef, stickRef } = useAutoScroll(
    messages,
    agent.isRunning,
  );

  // Send pipeline: consume any ready attachments at submit time, build
  // the multimodal `content` array if needed, then dispatch the run.
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      // Consume queued uploads first so they get sent even if the user
      // didn't type any text alongside them.
      const ready = consumeAttachments();
      if (!trimmed && ready.length === 0) return;
      if (agent.isRunning) return;

      stickRef.current = true;
      setError(null);

      const content = buildContent(trimmed, ready);
      agent.addMessage({
        id: generateMessageId(),
        role: "user",
        content,
      });
      void copilotkit.runAgent({ agent }).catch((err) => {
        console.error("[headless-complete] runAgent failed", err);
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [agent, copilotkit, consumeAttachments, stickRef],
  );

  const handleSend = useCallback(() => {
    sendText(input);
    setInput("");
  }, [input, sendText]);

  const handleSuggestion = useCallback(
    (text: string) => {
      sendText(text);
    },
    [sendText],
  );

  const handleReset = useCallback(() => {
    if (agent.isRunning) {
      try {
        agent.abortRun();
      } catch {
        // no-op: some transports don't support abort
      }
    }
    agent.setMessages([]);
    setInput("");
    setError(null);
    stickRef.current = true;
  }, [agent, stickRef]);
  // @endregion[page-send-message]

  const showTypingIndicator = useTypingIndicator(messages, agent.isRunning);

  const hasUploadingAttachment = attachments.some(
    (a) => a.status === "uploading",
  );
  const hasReadyAttachment = attachments.some((a) => a.status === "ready");
  const sendDisabled =
    agent.isRunning ||
    hasUploadingAttachment ||
    (!input.trim() && !hasReadyAttachment);
  const canReset = messages.length > 0 || agent.isRunning;
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen w-full justify-center bg-background p-4 sm:p-6">
      <Card className="flex h-full w-full max-w-3xl flex-col gap-0 overflow-hidden border-border py-0 shadow-2xl shadow-black/10">
        <Header onReset={handleReset} canReset={canReset} />

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {!hasMessages ? (
            // Render empty state outside the ScrollArea so flex-1 + justify-
            // center actually fills the available height. Radix ScrollArea
            // wraps its content in a `display: table` div that breaks
            // `h-full` propagation, so a centered empty state inside it
            // hugs the top of the viewport.
            <div className="flex min-h-0 flex-1 flex-col">
              <EmptyState onPick={handleSuggestion} />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div
                ref={listRef}
                className={cn("flex flex-col gap-4 px-4 py-4 sm:px-6")}
              >
                <MessageList messages={messages} />
                {showTypingIndicator && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}

          {hasMessages && (
            <SuggestionBar
              agentId={agentId}
              isRunning={agent.isRunning}
              onPick={handleSuggestion}
            />
          )}

          {error && (
            <div
              data-testid="headless-complete-error"
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
            onSend={handleSend}
            disabled={sendDisabled}
            isRunning={agent.isRunning}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            onFileChange={handleFileUpload}
            fileInputRef={fileInputRef}
            containerRef={containerRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            dragOver={dragOver}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// Build the user message body. If no attachments, send a plain string
// (legacy shape). If attachments are present, send the multimodal array
// — text first, then each attachment as its own InputContent part.
function buildContent(
  text: string,
  attachments: Attachment[],
): string | InputContent[] {
  if (attachments.length === 0) return text;
  const parts: InputContent[] = [];
  if (text) parts.push({ type: "text", text });
  for (const att of attachments) {
    parts.push({
      type: att.type,
      source: att.source,
      metadata: {
        ...(att.filename ? { filename: att.filename } : {}),
        ...att.metadata,
      },
    } as InputContent);
  }
  return parts;
}
