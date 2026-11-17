"use client";

/**
 * Hand-rolled chat shell.
 *
 * Owns the read/write loop:
 * - `useAgent`: message list, isRunning, addMessage, abortRun, setMessages
 * - `useCopilotKit`: `runAgent({ agent })` to dispatch a turn
 *
 * Renders the message tree with `<MessageList />` (which uses
 * `useRenderToolCall` and `useRenderActivityMessage` internally), shows
 * a typing indicator while the agent is thinking, and puts the suggestion
 * bar and the composer (with attachments) at the bottom.
 *
 * The visual chrome is identical to `headless-simple/chat.tsx`: same
 * outer wrapper, same `Card` shell, same bubble palette. The two demos
 * read as a pair.
 */

import React, { useCallback, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { randomUUID } from "@copilotkit/shared";
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
  const messages = agent.messages;
  const { listRef, bottomRef, stickRef } = useAutoScroll(
    messages,
    agent.isRunning,
  );

  // Send pipeline: consume any ready attachments at submit time, build
  // the multimodal `content` array if needed, then dispatch the run.
  // Returns false when nothing was sent, so the caller keeps the input.
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      // Check before consuming: consuming clears the queued uploads. If the
      // turn does not start, the uploads are lost.
      if (agent.isRunning) return false;
      // Consume queued uploads first, so that they are sent even when the
      // user typed no text with them.
      const ready = consumeAttachments();
      if (!trimmed && ready.length === 0) return false;

      stickRef.current = true;

      const content = buildContent(trimmed, ready);
      agent.addMessage({
        // `crypto.randomUUID` exists only on HTTPS and localhost pages.
        // `randomUUID` from @copilotkit/shared also works on plain HTTP.
        id: randomUUID(),
        role: "user",
        content,
      });
      void copilotkit
        .runAgent({ agent })
        .catch((err) =>
          console.error("[headless-complete] runAgent failed", err),
        );
      return true;
    },
    [agent, copilotkit, consumeAttachments, stickRef],
  );

  const handleSend = useCallback(() => {
    if (sendText(input)) {
      setInput("");
    }
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
            // Render the empty state outside the ScrollArea, so that flex-1
            // and justify-center fill the available height. Radix
            // ScrollArea wraps its content in a `display: table` div that
            // breaks `h-full`, so a centered empty state inside it hugs the
            // top of the viewport.
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

// Build the user message body. Without attachments, send a plain string.
// With attachments, send the multimodal array: the text first, then each
// attachment as its own InputContent part.
function buildContent(text: string, attachments: Attachment[]) {
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
    });
  }
  return parts;
}
