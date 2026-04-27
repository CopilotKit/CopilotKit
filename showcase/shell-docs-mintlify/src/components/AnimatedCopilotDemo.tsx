import type { ScriptEntry } from "./AnimatedCopilotDemo.script";

export interface DemoMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface DemoState {
  messages: DemoMessage[];
  typedInputText: string;
  isAssistantTyping: boolean;
  pageEffectColor: string | null;
}

export const initialState: DemoState = {
  messages: [],
  typedInputText: "",
  isAssistantTyping: false,
  pageEffectColor: null,
};

let messageCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++messageCounter}`;

function applyEntry(state: DemoState, entry: ScriptEntry): DemoState {
  switch (entry.action) {
    case "type-input":
      return { ...state, typedInputText: entry.text };
    case "submit-user-message": {
      if (!state.typedInputText) return state;
      const msg: DemoMessage = {
        id: nextId("u"),
        role: "user",
        content: state.typedInputText,
      };
      return { ...state, messages: [...state.messages, msg], typedInputText: "" };
    }
    case "assistant-typing":
      return { ...state, isAssistantTyping: entry.on };
    case "assistant-message": {
      const msg: DemoMessage = {
        id: nextId("a"),
        role: "assistant",
        content: entry.text,
      };
      return { ...state, messages: [...state.messages, msg] };
    }
    case "tool-call": {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          const existing = msgs[i].toolCalls ?? [];
          msgs[i] = {
            ...msgs[i],
            toolCalls: [
              ...existing,
              {
                id: nextId("tc"),
                type: "function",
                function: { name: entry.name, arguments: JSON.stringify(entry.args) },
              },
            ],
          };
          break;
        }
      }
      return { ...state, messages: msgs };
    }
    case "tool-result":
      return state; // result is implicit — UI shows the call as completed
    case "page-effect":
      return { ...state, pageEffectColor: entry.color };
    case "reset":
      messageCounter = 0;
      return initialState;
  }
}

export function advanceState(state: DemoState, entries: ReadonlyArray<ScriptEntry>): DemoState {
  return entries.reduce(applyEntry, state);
}

import { useEffect, useReducer, useRef } from "react";
import {
  CopilotChatUserMessage,
  CopilotChatAssistantMessage,
  CopilotChatInput,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import type { UserMessage, AssistantMessage } from "@ag-ui/core";
import { SCRIPT } from "./AnimatedCopilotDemo.script";

// CopilotChatToolCallsView depends on `useRenderToolCall`, which requires the
// full CopilotKitProvider (and the runtime, inspector, and a2ui machinery
// that comes with it). The animated demo intentionally has no runtime, so we
// override the assistant message's tool-call slot with a no-op and render a
// lightweight pill ourselves to indicate the call.
const NoToolCalls = () => null;

type Action = { type: "tick"; entries: ScriptEntry[] } | { type: "reset" };

function reducer(state: DemoState, action: Action): DemoState {
  if (action.type === "reset") return initialState;
  return advanceState(state, action.entries);
}

function toUserMessage(m: DemoMessage): UserMessage {
  return { id: m.id, role: "user", content: m.content };
}

function toAssistantMessage(m: DemoMessage): AssistantMessage {
  // Tool calls are rendered via our own pill below the assistant message,
  // not through CopilotKit's tool-call slot, so we omit them from the
  // AG-UI message here.
  return {
    id: m.id,
    role: "assistant",
    content: m.content,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The static frame for reduced-motion users: replay the script up to (but not
// including) the reset, so the page-effect can persist visually.
const STATIC_FRAME: DemoState = advanceState(
  initialState,
  SCRIPT.filter((e) => e.action !== "reset"),
);

export interface AnimatedCopilotDemoProps {
  className?: string;
}

export function AnimatedCopilotDemo({ className }: AnimatedCopilotDemoProps) {
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  const [state, dispatch] = useReducer(reducer, reduced ? STATIC_FRAME : initialState);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let cursor = 0;
    let start = performance.now();

    function loop(now: number) {
      if (cancelled) return;
      const elapsed = now - start;
      const due: ScriptEntry[] = [];
      while (cursor < SCRIPT.length && SCRIPT[cursor].at <= elapsed) {
        due.push(SCRIPT[cursor]);
        cursor++;
      }
      if (due.length) dispatch({ type: "tick", entries: due });
      if (cursor >= SCRIPT.length) {
        // Schedule next loop after a brief pause.
        setTimeout(() => {
          if (cancelled) return;
          cursor = 0;
          start = performance.now();
          dispatch({ type: "reset" });
          requestAnimationFrame(loop);
        }, 600);
        return;
      }
      requestAnimationFrame(loop);
    }
    const handle = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [reduced]);

  return (
    <CopilotChatConfigurationProvider agentId="docs-demo" threadId="docs-demo-thread">
      <div
        ref={containerRef}
        className={
          "relative rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden " +
          "bg-white dark:bg-zinc-950 " +
          (className ?? "")
        }
        aria-label="Animated CopilotKit demo"
      >
        {/* Faux chrome — anchors the visual as a chat surface */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-zinc-900/60">
          <span className="w-2 h-2 rounded-full bg-(--primary)" />
          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">CopilotKit demo</span>
          {state.pageEffectColor && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-mono text-gray-500 dark:text-gray-400">
              <span className="text-gray-400 dark:text-gray-500">background</span>
              <span
                className="inline-block w-3 h-3 rounded-sm border border-black/10 dark:border-white/10 transition-colors duration-500"
                style={{ backgroundColor: state.pageEffectColor }}
              />
              <span>{state.pageEffectColor}</span>
            </span>
          )}
        </div>

        <div className="h-[360px] flex flex-col">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {state.messages.map((m) =>
              m.role === "user" ? (
                <CopilotChatUserMessage key={m.id} message={toUserMessage(m)} />
              ) : (
                <div key={m.id}>
                  <CopilotChatAssistantMessage
                    message={toAssistantMessage(m)}
                    isRunning={state.isAssistantTyping}
                    toolCallsView={NoToolCalls}
                  />
                  {m.toolCalls?.map((tc) => {
                    let args: Record<string, unknown> = {};
                    try {
                      args = JSON.parse(tc.function.arguments);
                    } catch {
                      // ignore — fall through to raw rendering
                    }
                    const colorArg = typeof args.color === "string" ? args.color : null;
                    const argText = Object.entries(args)
                      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                      .join(", ");
                    return (
                      <div
                        key={tc.id}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-zinc-900 px-2 py-1 text-[11px] font-mono text-gray-700 dark:text-gray-300"
                      >
                        <span className="text-(--primary)">⚙</span>
                        <span className="font-semibold">{tc.function.name}</span>
                        {colorArg && (
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm border border-black/10 dark:border-white/10"
                            style={{ backgroundColor: colorArg }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="text-gray-500 dark:text-gray-400">({argText || tc.function.arguments})</span>
                        <span className="text-green-600 dark:text-green-400">✓</span>
                      </div>
                    );
                  })}
                </div>
              ),
            )}
            {state.isAssistantTyping && state.messages.length > 0 && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 animate-pulse pl-2">
                Assistant is typing…
              </div>
            )}
          </div>
          <div className="border-t border-gray-200 dark:border-gray-800 p-2">
            <CopilotChatInput value={state.typedInputText} onChange={() => {}} onSubmitMessage={() => {}} />
          </div>
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

export default AnimatedCopilotDemo;
