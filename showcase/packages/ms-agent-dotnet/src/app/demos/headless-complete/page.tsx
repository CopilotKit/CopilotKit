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
 * This file owns the provider, agent wiring, the top-level send/stop
 * handlers, tool-call renderer registration, and the composer chrome. The
 * pure presentational message list lives in `message-list.tsx`, and the
 * per-message role dispatch lives in `use-rendered-messages.tsx`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CopilotKit,
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
  useConfigureSuggestions,
  useRenderTool,
  useDefaultRenderTool,
  useComponent,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { z } from "zod";
import { MessageList } from "./message-list";

const AGENT_ID = "headless-complete";

// Outer wrapper — provides the CopilotKit runtime + page layout. Routes
// through `/api/copilotkit` which proxies to the .NET SalesAgent.
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
  // @endregion[page-send-message]

  // Wrap the chat body in a CopilotChatConfigurationProvider so the rendering
  // primitives used inside `useRenderedMessages` (useRenderToolCall,
  // useRenderActivityMessage, useRenderCustomMessages) see a matching
  // (agentId, threadId) pair — without it, activity-message renderers
  // wouldn't scope to this agent and custom message renderers would
  // early-return null. This provider is independent of the <CopilotChat />
  // component; using it here keeps the surface fully headless while still
  // unlocking the full generative-UI composition.
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
// frontend-registered `useComponent` tools register against this agent.
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
        title: "Flights SFO → JFK",
        message: "Search for flights from SFO to JFK.",
      },
      {
        title: "Highlight a note",
        message: "Highlight 'meeting at 3pm' in yellow.",
      },
      {
        title: "Show a card",
        message: "Show a card titled 'Reminder' with body 'Call the client.'",
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

// =========================================================================
// Tool-call renderers
// =========================================================================
//
// Central registration hook for every tool-call rendering surface exercised
// by the headless-complete cell:
//   - `useRenderTool({ name: "get_weather", ... })` — per-tool renderer for
//     the backend .NET SalesAgent's weather tool (blue card).
//   - `useComponent({ name: "highlight_note", ... })` — frontend-only tool
//     the agent can invoke; renders the `HighlightNote` component inline
//     through the same `useRenderToolCall` path.
//   - `useComponent({ name: "show_card", ... })` — frontend-only card
//     renderer, matches the simple demo's tool so suggestions work across
//     both.
//   - `useDefaultRenderTool(...)` — wildcard catch-all so any other tool
//     the agent might call (e.g. `search_flights`, `generate_a2ui`) still
//     gets a visible card.
// @region[headless-complete-tool-renderers]
function useHeadlessCompleteToolRenderers() {
  // Per-tool renderer: backend `get_weather` -> branded WeatherCard. The
  // .NET SalesAgent returns `{ city, temperature, conditions, humidity,
  // wind_speed, feels_like }`.
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

  // Frontend-registered tool the agent can invoke. `useComponent` is
  // sugar over `useFrontendTool`, so the registration flows through the
  // same `useRenderToolCall` path the manual hook consumes.
  useComponent({
    name: "highlight_note",
    description:
      "Highlight a short note or phrase inline in the chat with a colored card. Use this whenever the user asks to highlight, flag, or mark a snippet of text.",
    parameters: highlightNotePropsSchema,
    render: HighlightNote,
  });

  useComponent({
    name: "show_card",
    description: "Display a titled card with a short body of text.",
    parameters: z.object({
      title: z.string().describe("Short heading for the card."),
      body: z.string().describe("Body text for the card."),
    }),
    render: ShowCard,
  });

  // Wildcard catch-all for tools without a bespoke renderer (e.g.
  // `search_flights`, `generate_a2ui`, `get_sales_todos`).
  useDefaultRenderTool();
}
// @endregion[headless-complete-tool-renderers]

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}

// =========================================================================
// Presentational components (bubbles, typing indicator, input bar, cards)
// =========================================================================

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
  return (
    <div className="mt-2 mb-2 max-w-xs rounded-xl border border-[#DBDBE5] bg-[#EDEDF5] p-3 text-[#010507] shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
            {loading ? "Fetching weather" : "Weather"}
          </div>
          <div className="truncate text-sm font-semibold capitalize text-[#010507]">
            {location || "Unknown"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold leading-none text-[#010507] tracking-tight">
            {loading ? "..." : temperature != null ? `${temperature}°` : "--"}
          </div>
          {!loading && (
            <div className="mt-0.5 text-[11px] capitalize text-[#57575B]">
              {conditions ?? ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const highlightNotePropsSchema = z.object({
  text: z.string().describe("The note text to highlight."),
  color: z
    .enum(["yellow", "pink", "green", "blue"])
    .describe("Highlight color for the note."),
});

type HighlightNoteProps = z.infer<typeof highlightNotePropsSchema>;

const HIGHLIGHT_COLOR_CLASSES: Record<HighlightNoteProps["color"], string> = {
  yellow: "bg-[#FFF388]/30 border-[#FFF388] text-[#010507]",
  pink: "bg-[#FA5F67]/10 border-[#FA5F6733] text-[#010507]",
  green: "bg-[#85ECCE]/20 border-[#85ECCE4D] text-[#010507]",
  blue: "bg-[#BEC2FF1A] border-[#BEC2FF] text-[#010507]",
};

function HighlightNote({ text, color }: HighlightNoteProps) {
  const cls = HIGHLIGHT_COLOR_CLASSES[color] ?? HIGHLIGHT_COLOR_CLASSES.yellow;
  return (
    <div
      className={`mt-2 mb-2 inline-block rounded-xl border px-3 py-2 text-sm font-medium shadow-sm ${cls}`}
    >
      <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
        Note
      </span>
      {text}
    </div>
  );
}

function ShowCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="my-2 rounded-lg border border-gray-300 bg-white p-4 shadow-sm">
      <div className="font-semibold text-gray-900">{title}</div>
      <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
        {body}
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
