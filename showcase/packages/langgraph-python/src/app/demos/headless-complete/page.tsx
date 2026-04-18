"use client";

/**
 * Headless Chat (Complete)
 *
 * A full chat implementation built from scratch on `useAgent`, without using
 * `<CopilotChat />`. Demonstrates:
 *   - scrollable messages area with auto-scroll to bottom on new messages
 *   - distinct user vs assistant bubbles
 *   - text input + send button, disabled while running
 *   - inline tool-call rendering via `useRenderToolCall`
 *   - stop button to cancel a running agent turn
 *
 * Everything below is plain React. No `CopilotChat`, no state libraries.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CopilotKit,
  useAgent,
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import type {
  AssistantMessage,
  Message,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";

const AGENT_ID = "headless-complete";

// Outer wrapper — provides the CopilotKit runtime + page layout.
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

// Inner view — the actual chat. Reads messages + isRunning straight off the agent.
function Chat() {
  const threadId = useMemo(() => crypto.randomUUID(), []);
  const { agent } = useAgent({ agentId: AGENT_ID, threadId });
  const { copilotkit } = useCopilotKit();

  // Connect the agent on mount so the backend session is live before the first
  // send. Mirrors CopilotChat's connect effect (abort on unmount to play nice
  // with React StrictMode).
  useEffect(() => {
    const ac = new AbortController();
    // HttpAgent honors abortController.signal; assign before connect.
    if ("abortController" in agent) {
      (
        agent as unknown as { abortController: AbortController }
      ).abortController = ac;
    }
    copilotkit.connectAgent({ agent }).catch(() => {
      // connectAgent emits via the subscriber system; swallow here to avoid
      // unhandled-rejection noise on unmount.
    });
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

// Scrollable messages area. Auto-scrolls to the bottom whenever the message
// list grows or content streams in.
function MessageList({
  messages,
  isRunning,
}: {
  messages: Message[];
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a cheap fingerprint so we auto-scroll on streaming content changes
  // (not just new messages). Mirrors the approach in CopilotChat.
  const fingerprint = messages
    .map((m) => {
      const contentLen =
        typeof m.content === "string"
          ? m.content.length
          : Array.isArray(m.content)
            ? m.content.length
            : 0;
      const tcLen =
        "toolCalls" in m && Array.isArray(m.toolCalls)
          ? m.toolCalls.map((tc) => tc.function.arguments.length).join(",")
          : "";
      return `${m.id}:${contentLen}:${tcLen}`;
    })
    .join("|");

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [fingerprint, isRunning]);

  // Only render user + assistant messages. Tool (role="tool") messages are
  // consumed inline by the assistant bubble that produced the tool call.
  const visible = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return (
    <div
      ref={scrollRef}
      data-testid="headless-complete-messages"
      className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
    >
      {visible.length === 0 && (
        <div className="text-center text-sm text-gray-400 mt-8">
          Ask for a bar chart or a pie chart to see inline tool rendering.
        </div>
      )}
      {visible.map((m) =>
        m.role === "user" ? (
          <UserBubble key={m.id} message={m as UserMessage} />
        ) : (
          <AssistantBubble
            key={m.id}
            message={m as AssistantMessage}
            allMessages={messages}
          />
        ),
      )}
      {isRunning && <TypingDot />}
    </div>
  );
}

function UserBubble({ message }: { message: UserMessage }) {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((p) => (p.type === "text" ? p.text : "")).join("")
        : "";
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-blue-600 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  allMessages,
}: {
  message: AssistantMessage;
  allMessages: Message[];
}) {
  const renderToolCall = useRenderToolCall();
  const text = message.content ?? "";
  const toolCalls = message.toolCalls ?? [];
  const hasText = text.length > 0;
  const hasTools = toolCalls.length > 0;

  if (!hasText && !hasTools) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex flex-col gap-2">
        {hasText && (
          <div className="rounded-2xl rounded-bl-sm bg-gray-100 text-gray-900 px-4 py-2 text-sm whitespace-pre-wrap break-words">
            {text}
          </div>
        )}
        {hasTools && (
          <div className="flex flex-col gap-2">
            {toolCalls.map((tc) => {
              const toolMessage = allMessages.find(
                (m) => m.role === "tool" && m.toolCallId === tc.id,
              ) as ToolMessage | undefined;
              return (
                <React.Fragment key={tc.id}>
                  {renderToolCall({ toolCall: tc, toolMessage })}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDot() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3">
        <span className="inline-block w-2 h-2 bg-gray-500 rounded-full animate-pulse" />
      </div>
    </div>
  );
}

function InputBar({
  value,
  onChange,
  onSubmit,
  onStop,
  isRunning,
  canStop,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isRunning: boolean;
  canStop: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <form
      className="border-t border-gray-200 p-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? "Agent is working..." : "Type a message..."}
        disabled={isRunning}
        className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
      />
      {canStop ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-full px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={isRunning || value.trim().length === 0}
          className="rounded-full px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Send
        </button>
      )}
    </form>
  );
}
