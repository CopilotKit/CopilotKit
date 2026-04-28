"use client";

/**
 * Headless Chat (Complete) — TRULY headless.
 *
 * A full chat implementation built from scratch on `useAgent`, without
 * `<CopilotChat />` / `<CopilotChatMessageView>` / `<CopilotChatAssistantMessage>`.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopilotKit,
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { MessageList } from "./message-list";
import { InputBar } from "./input-bar";
import { useHeadlessCompleteToolRenderers } from "./tool-renderers";

const AGENT_ID = "headless-complete";

export default function HeadlessCompleteDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full bg-gray-50">
        <div className="h-full w-full max-w-3xl flex flex-col bg-white shadow-sm">
          <header className="px-4 py-3 border-b border-gray-200">
            <h1 className="text-base font-semibold">
              Headless Chat (Complete)
            </h1>
            <p className="text-xs text-gray-500">
              Built from scratch on useAgent — no CopilotChat.
            </p>
          </header>
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  const threadId = useMemo(() => crypto.randomUUID(), []);
  const { agent } = useAgent({ agentId: AGENT_ID, threadId });
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const ac = new AbortController();
    if ("abortController" in agent) {
      (
        agent as unknown as { abortController: AbortController }
      ).abortController = ac;
    }
    copilotkit.connectAgent({ agent }).catch(() => {});
    return () => {
      ac.abort();
      void agent.detachActiveRun().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, threadId]);

  const [input, setInput] = useState("");
  const messages = agent.messages as Message[];
  const isRunning = agent.isRunning;

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });
    try {
      await copilotkit.runAgent({ agent });
    } catch (err) {
      console.error("headless-complete: runAgent failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, input, isRunning]);

  const handleStop = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (err) {
      console.error("headless-complete: stopAgent failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  return (
    <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
      <ChatBody
        messages={messages}
        isRunning={isRunning}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        handleStop={handleStop}
      />
    </CopilotChatConfigurationProvider>
  );
}

function ChatBody({
  messages,
  isRunning,
  input,
  setInput,
  handleSubmit,
  handleStop,
}: {
  messages: Message[];
  isRunning: boolean;
  input: string;
  setInput: (next: string) => void;
  handleSubmit: () => void;
  handleStop: () => void;
}) {
  useHeadlessCompleteToolRenderers();

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in Tokyo",
        message: "What's the weather in Tokyo?",
      },
      {
        title: "Highlight a note",
        message: "Highlight 'meeting at 3pm' in yellow.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList messages={messages} isRunning={isRunning} />
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={handleStop}
        isRunning={isRunning}
        canStop={isRunning && messages.length > 0}
      />
    </div>
  );
}
