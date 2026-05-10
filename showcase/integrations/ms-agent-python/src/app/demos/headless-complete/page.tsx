"use client";

/**
 * Headless Chat (Complete) — TRULY headless.
 *
 * A full chat implementation built from scratch on `useAgent`, without using
 * `<CopilotChat />` AND without `<CopilotChatMessageView>` or
 * `<CopilotChatAssistantMessage>`. Demonstrates:
 *   - scrollable messages area with auto-scroll to bottom on new messages
 *   - distinct user vs assistant bubbles (pure chrome — no chat primitives)
 *   - text input + send button, disabled while running
 *   - stop button to cancel a running agent turn
 *   - the FULL generative UI composition — text, reasoning cards, tool-call
 *     renderings (`useRenderTool` / `useDefaultRenderTool` / `useComponent` /
 *     `useFrontendTool`), activity messages, and custom-message renderers —
 *     re-composed by hand from the low-level hooks (`useRenderToolCall`,
 *     `useRenderActivityMessage`, `useRenderCustomMessages`) inside
 *     `use-rendered-messages.tsx`.
 *
 * This file owns the provider, the agent wiring, the top-level send/stop
 * handlers, the input bar, and the frontend tool registrations. The
 * message list + bubble chrome live in `message-list.tsx`; the per-message
 * composition hook lives in `use-rendered-messages.tsx`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
  useRenderTool,
  useDefaultRenderTool,
  useComponent,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import type { Message } from "@ag-ui/core";
import { z } from "zod";
import { MessageList } from "./message-list";

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

// Inner view — the actual chat. Reads messages + isRunning straight off the
// agent, wires up the connect/run/stop lifecycle, and hands the pure
// presentational pieces their props.
function Chat() {
  // @region[page-send-message]
  const threadId = useMemo(() => crypto.randomUUID(), []);
  const { agent } = useAgent({ agentId: AGENT_ID, threadId });
  const { copilotkit } = useCopilotKit();

  // Connect the agent on mount so the backend session is live before the first
  // send. Mirrors the internal connect effect used by CopilotChat (abort on
  // unmount to play nice with React StrictMode).
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

  const handleSubmit = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
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
    },
    [agent, input, isRunning],
  );

  const handleStop = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (err) {
      console.error("headless-complete: stopAgent failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);
  // @endregion[page-send-message]

  // Wrap the chat body in a CopilotChatConfigurationProvider so that the
  // rendering primitives used inside `useRenderedMessages`
  // (useRenderToolCall, useRenderActivityMessage, useRenderCustomMessages)
  // see a matching (agentId, threadId) pair. This provider is independent
  // of the <CopilotChat /> component; using it here keeps the surface fully
  // headless while still unlocking the full generative-UI composition.
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

// Nested body — rendered INSIDE CopilotChatConfigurationProvider so the
// suggestions hook picks up the correct (agentId, threadId) scope and
// the frontend-registered tools register against this agent.
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
  handleSubmit: (override?: string) => void;
  handleStop: () => void;
}) {
  useHeadlessCompleteToolRenderers();

  const suggestions = [
    { title: "Weather in Tokyo", message: "What's the weather in Tokyo?" },
    { title: "AAPL stock price", message: "What's AAPL trading at right now?" },
    {
      title: "Highlight a note",
      message: "Highlight 'meeting at 3pm' in yellow.",
    },
    {
      title: "Sketch a diagram",
      message: "Use Excalidraw to sketch a simple system diagram.",
    },
    { title: "Largest continent", message: "What is the largest continent?" },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList messages={messages} isRunning={isRunning} />
      <div
        data-testid="headless-suggestions"
        className="flex flex-wrap gap-2 px-4 py-2 border-t border-[#E9E9EF] bg-white"
      >
        {suggestions.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => handleSubmit(s.message)}
            disabled={isRunning}
            className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {s.title}
          </button>
        ))}
      </div>
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

/**
 * Composer for the headless chat.
 *
 * A textarea plus a Send / Stop toggle. Enter submits; Shift+Enter inserts a
 * newline. The textarea is disabled while the agent is running so users can't
 * pile up concurrent turns.
 */
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
  onSubmit: (override?: string) => void;
  onStop: () => void;
  isRunning: boolean;
  canStop: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <form
      className="border-t border-[#E9E9EF] p-3 flex gap-2 items-end bg-white"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? "Agent is working..." : "Type a message..."}
        disabled={isRunning}
        className="flex-1 resize-none rounded-2xl border border-[#DBDBE5] bg-white px-4 py-2 text-sm leading-6 text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33] disabled:bg-[#FAFAFC] disabled:text-[#AFAFB7]"
      />
      {canStop ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-full px-4 py-2 text-sm font-medium bg-[#FA5F67] text-white hover:opacity-90 transition-opacity"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={isRunning || value.trim().length === 0}
          className="rounded-full px-4 py-2 text-sm font-medium bg-[#010507] text-white hover:bg-[#2B2B2B] disabled:bg-[#DBDBE5] disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      )}
    </form>
  );
}

/**
 * Central registration hook for every tool-call rendering surface exercised
 * by the headless-complete cell against the shared MS Agent backend:
 *
 *   - `useRenderTool({ name: "get_weather", ... })` — per-tool renderer for
 *     the backend weather tool (blue card).
 *   - `useComponent({ name: "highlight_note", ... })` — frontend-only tool
 *     the agent can invoke; renders inline through the same
 *     `useRenderToolCall` path.
 *   - `useDefaultRenderTool(...)` — wildcard catch-all so any other tool
 *     the agent might call (sales todos, schedule meeting, search flights,
 *     generate_a2ui) still gets a visible card even though the headless
 *     cell composes its own message view.
 */
function useHeadlessCompleteToolRenderers() {
  // Per-tool renderer: backend `get_weather` -> branded WeatherCard.
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<{
          city?: string;
          temperature?: number;
          conditions?: string;
        }>(result);
        return (
          <WeatherCard
            loading={loading}
            location={parameters?.location ?? parsed.city ?? ""}
            temperature={parsed.temperature}
            conditions={parsed.conditions}
          />
        );
      },
    },
    [],
  );

  // Frontend-registered tool the agent can invoke. `useComponent` is sugar
  // over `useFrontendTool`, so the registration flows through the same
  // `useRenderToolCall` path the manual hook consumes.
  useComponent({
    name: "highlight_note",
    description:
      "Highlight a short note or phrase inline in the chat with a colored card. Use this whenever the user asks to highlight, flag, or mark a snippet of text.",
    parameters: highlightNotePropsSchema,
    render: HighlightNote,
  });

  // Wildcard catch-all for tools without a bespoke renderer (sales todos,
  // schedule meeting, search flights, generate_a2ui — the shared MS Agent
  // backend tools).
  useDefaultRenderTool();
}

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Small weather card — inline styled (no Tailwind reliance inside CopilotKit's
 * render tree) to match the showcase styling guide.
 */
function WeatherCard({
  loading,
  location,
  temperature,
  conditions,
}: {
  loading: boolean;
  location: string;
  temperature?: number;
  conditions?: string;
}) {
  if (loading) {
    return (
      <div
        style={{
          borderRadius: 12,
          padding: 16,
          background: "#667eea",
          color: "white",
          maxWidth: 320,
          marginTop: 8,
          marginBottom: 8,
        }}
      >
        Loading weather for {location}…
      </div>
    );
  }
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        background: "#667eea",
        color: "white",
        maxWidth: 320,
        marginTop: 8,
        marginBottom: 8,
      }}
    >
      <div
        style={{ fontWeight: 600, fontSize: 16, textTransform: "capitalize" }}
      >
        {location}
      </div>
      {typeof temperature === "number" && (
        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>
          {temperature}°C
        </div>
      )}
      {conditions && (
        <div
          style={{ fontSize: 14, opacity: 0.9, textTransform: "capitalize" }}
        >
          {conditions}
        </div>
      )}
    </div>
  );
}

/**
 * Small colored card the agent can request via the `highlight_note` frontend
 * tool. Kept inline because `useComponent` renders its children inside the
 * CopilotKit tree, where Tailwind purge can strip classes.
 */
const highlightNotePropsSchema = z.object({
  text: z.string().describe("The note text to highlight."),
  color: z
    .enum(["yellow", "blue", "green", "pink"])
    .default("yellow")
    .describe("Highlight color."),
});

const HIGHLIGHT_COLORS: Record<string, { bg: string; border: string }> = {
  yellow: { bg: "#FFF7B1", border: "#E8D54A" },
  blue: { bg: "#DCE9FF", border: "#7CA7E8" },
  green: { bg: "#D9F2DC", border: "#67B36F" },
  pink: { bg: "#FFD9E7", border: "#E87CA9" },
};

function HighlightNote({
  text,
  color = "yellow",
}: z.infer<typeof highlightNotePropsSchema>) {
  const palette = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS.yellow;
  return (
    <div
      style={{
        display: "inline-block",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        marginTop: 6,
        marginBottom: 6,
        fontSize: 14,
        color: "#010507",
      }}
    >
      {text}
    </div>
  );
}
