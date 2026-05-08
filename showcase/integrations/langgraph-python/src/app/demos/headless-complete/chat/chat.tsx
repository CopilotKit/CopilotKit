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

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import type { Attachment, InputContent } from "@copilotkit/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useAttachmentsConfig } from "../attachments/use-attachments-config";
import { Composer } from "./composer";
import { EmptyState } from "./empty-state";
import { Header } from "./header";
import { MessageList } from "./message-list";
import { SuggestionBar } from "./suggestion-bar";
import { TypingIndicator } from "./typing-indicator";

export function Chat({ agentId }: { agentId: string }) {
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

  // Track the Radix ScrollArea viewport so we can attach scroll listeners
  // and auto-stick to the bottom on new messages.
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const stickToBottom = useRef(true);

  const messages = agent.messages;

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    viewportRef.current = node.closest(
      "[data-slot='scroll-area-viewport']",
    ) as HTMLElement | null;
  }, []);

  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 80;
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, agent.isRunning]);

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

      stickToBottom.current = true;

      const content = buildContent(trimmed, ready);
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content,
      });
      void copilotkit.runAgent({ agent }).catch(() => {});
    },
    [agent, copilotkit, consumeAttachments],
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
    stickToBottom.current = true;
  }, [agent]);

  const showTypingIndicator = useMemo(() => {
    if (!agent.isRunning) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
    if (last.role === "assistant") {
      const hasContent =
        typeof last.content === "string" && last.content.length > 0;
      const hasToolCalls =
        "toolCalls" in last &&
        Array.isArray(last.toolCalls) &&
        last.toolCalls.length > 0;
      return !hasContent && !hasToolCalls;
    }
    return false;
  }, [agent.isRunning, messages]);

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
