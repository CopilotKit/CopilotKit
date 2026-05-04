/**
 * Source string of the PlaygroundChat module written into the generated
 * playground entry directory at codegen time.
 *
 * The chat surface drives the runtime DIRECTLY rather than going through
 * `copilotkit.runAgent({ agent })`. After multiple debug rounds, runAgent
 * silently completes without firing a fetch in this environment — agent
 * is somehow inert. We fetch the SSE endpoint ourselves with a hand-built
 * RunAgentInput and parse the AG-UI event stream into local state.
 *
 * The user's hook registrations (useFrontendTool, useRenderTool,
 * useComponent, useCopilotAction({ render }), useDefaultRenderTool, …)
 * still register on the real CopilotKitProvider above us, so we look up
 * tool renderers via `useRenderToolCall()` — the same hook CopilotChat's
 * internals use — and render them inline.
 */
export const PLAYGROUND_CHAT_SOURCE = `
import * as React from "react";
import {
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";

const DEFAULT_AGENT_ID = "default";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getRuntimeUrl(copilotkit: unknown): string {
  // CopilotKit core stores runtimeUrl on the public surface — we read it
  // off the instance the user's CopilotKitProvider created.
  const c = copilotkit as { runtimeUrl?: string };
  return (c.runtimeUrl ?? "").replace(/\\/$/, "");
}

interface FrontendTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

interface RegisteredTool {
  name: string;
  handler?: (args: unknown, ctx: unknown) => Promise<unknown>;
}

function getFrontendTools(
  copilotkit: unknown,
  agentId: string,
): FrontendTool[] {
  // \`copilotkit.buildFrontendTools(agentId)\` is the same call CopilotKit's
  // run-handler uses to assemble the tool list it sends with each run.
  // It collects everything registered via useCopilotAction, useFrontendTool,
  // useHumanInTheLoop, etc. and converts to the AG-UI Tool shape. Without
  // this the model has no idea any of the user's hooks exist.
  const c = copilotkit as {
    buildFrontendTools?: (agentId?: string) => FrontendTool[];
    tools?: FrontendTool[];
  };
  if (typeof c.buildFrontendTools === "function") {
    try {
      return c.buildFrontendTools(agentId) ?? [];
    } catch {
      /* fall through */
    }
  }
  return Array.isArray(c.tools) ? c.tools : [];
}

function getRegisteredTools(copilotkit: unknown): RegisteredTool[] {
  // \`copilotkit.tools\` holds the live FrontendTool array, including
  // each tool's \`handler\` callback. We need this (not buildFrontendTools,
  // which strips handlers) to run a tool when the model calls it.
  const c = copilotkit as { tools?: RegisteredTool[] };
  return Array.isArray(c.tools) ? c.tools : [];
}

const MAX_TOOL_STEPS = 5;

export function PlaygroundChat(): React.ReactElement {
  const { copilotkit } = useCopilotKit();
  const renderToolCall = useRenderToolCall();
  const runtimeUrl = getRuntimeUrl(copilotkit);

  const [threadId] = React.useState(uuid);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isRunning, setIsRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const handleSend = React.useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    if (!runtimeUrl) {
      setError("PlaygroundChat: runtimeUrl missing on copilotkit instance");
      return;
    }

    setError(null);
    const userMsg: ChatMessage = {
      id: uuid(),
      role: "user",
      content: text,
    };
    let workingMessages: ChatMessage[] = [...messagesRef.current, userMsg];
    setMessages(workingMessages);
    setInput("");
    setIsRunning(true);

    try {
      // Tool-calling loop: each iteration POSTs the conversation, streams
      // back an assistant turn, then if the assistant emitted tool calls
      // we execute their handlers and feed the results back. Caps at
      // MAX_TOOL_STEPS so a misbehaving model can't loop forever.
      let lastTurn: { assistantMessage: ChatMessage; toolCalls: ToolCall[] } | null = null;
      let stepCount = 0;
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        stepCount = step + 1;
        const turn = await runOneTurn(workingMessages);
        lastTurn = turn;
        workingMessages = [...workingMessages, turn.assistantMessage];
        setMessages(workingMessages);

        if (!turn.toolCalls.length) break;

        // Execute every tool call's handler in parallel; append results
        // as tool messages.
        const registry = getRegisteredTools(copilotkit);
        const toolResults = await Promise.all(
          turn.toolCalls.map(async (tc): Promise<ChatMessage | null> => {
            const tool = registry.find((t) => t.name === tc.function.name);
            if (!tool || typeof tool.handler !== "function") {
              // No frontend handler — could be useHumanInTheLoop awaiting
              // user action, or a render-only tool. Surface the call but
              // don't synthesize a result; conversation halts here.
              return null;
            }
            let parsedArgs: unknown = {};
            try {
              parsedArgs = tc.function.arguments
                ? JSON.parse(tc.function.arguments)
                : {};
            } catch {
              parsedArgs = tc.function.arguments;
            }
            try {
              const result = await tool.handler(parsedArgs, {
                toolCall: tc,
                agent: null,
                signal: undefined,
              });
              return {
                id: uuid(),
                role: "tool",
                toolCallId: tc.id,
                content:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result ?? null),
              };
            } catch (err) {
              return {
                id: uuid(),
                role: "tool",
                toolCallId: tc.id,
                content: JSON.stringify({
                  error: err instanceof Error ? err.message : String(err),
                }),
              };
            }
          }),
        );

        const filledResults = toolResults.filter(
          (m): m is ChatMessage => m !== null,
        );
        if (filledResults.length === 0) break;

        workingMessages = [...workingMessages, ...filledResults];
        setMessages(workingMessages);
      }

      // If we exited the loop because we hit the cap and the final
      // assistant message has no text — the model just kept calling
      // tools and never spoke — surface that to the user instead of
      // leaving the chat dead-silent.
      if (
        lastTurn &&
        lastTurn.toolCalls.length > 0 &&
        !lastTurn.assistantMessage.content &&
        stepCount >= MAX_TOOL_STEPS
      ) {
        setError(
          \`Tool-calling loop hit the \${MAX_TOOL_STEPS}-step cap without a text reply. The model kept calling tools and their handlers returned values it couldn't use. Check the handlers (often returning "" / null) on your useFrontendTool / useCopilotAction registrations.\`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[playground-chat] send failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }

    /**
     * One turn: POST messages, stream the response, return the assistant
     * message we accumulated. Patches \`workingMessages\` into local state
     * as we go so deltas appear live.
     */
    async function runOneTurn(
      currentMessages: ChatMessage[],
    ): Promise<{ assistantMessage: ChatMessage; toolCalls: ToolCall[] }> {
      const runId = uuid();
      const assistantId = uuid();
      let textBuffer = "";
      const toolCalls: ToolCall[] = [];
      let inserted = false;

      const tools = getFrontendTools(copilotkit, DEFAULT_AGENT_ID);
      // eslint-disable-next-line no-console
      console.log(
        \`[playground-chat] POST \${runtimeUrl}/agent/\${DEFAULT_AGENT_ID}/run msgs=\${currentMessages.length} tools=\${tools.length}\`,
      );

      const res = await fetch(
        \`\${runtimeUrl}/agent/\${encodeURIComponent(DEFAULT_AGENT_ID)}/run\`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            threadId,
            runId,
            state: {},
            messages: currentMessages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
              ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
            })),
            tools,
            context: [],
            forwardedProps: {},
          }),
        },
      );
      if (!res.ok || !res.body) {
        throw new Error(\`runtime returned \${res.status}\`);
      }

      function ensureAssistant(): void {
        if (inserted) return;
        inserted = true;
        setMessages((m) => [
          ...m,
          { id: assistantId, role: "assistant", content: "", toolCalls: [] },
        ]);
      }

      function syncAssistant(): void {
        ensureAssistant();
        const snapshot = toolCalls.map((tc) => ({
          ...tc,
          function: { ...tc.function },
        }));
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: textBuffer, toolCalls: snapshot }
              : msg,
          ),
        );
      }

      function handleEvent(event: Record<string, unknown>): void {
        const type = event.type as string | undefined;
        if (
          type === "TEXT_MESSAGE_CHUNK" ||
          type === "TEXT_MESSAGE_CONTENT"
        ) {
          const delta = event.delta as string | undefined;
          if (typeof delta === "string") {
            textBuffer += delta;
            syncAssistant();
          }
          return;
        }
        if (type === "TOOL_CALL_START") {
          toolCalls.push({
            id: event.toolCallId as string,
            type: "function",
            function: {
              name: event.toolCallName as string,
              arguments: "",
            },
          });
          syncAssistant();
          return;
        }
        if (type === "TOOL_CALL_ARGS") {
          const id = event.toolCallId as string;
          const delta = event.delta as string | undefined;
          const tc = toolCalls.find((t) => t.id === id);
          if (tc && typeof delta === "string") {
            tc.function.arguments += delta;
            syncAssistant();
          }
          return;
        }
        if (type === "RUN_ERROR") {
          const message =
            (event.message as string | undefined) ?? "RUN_ERROR";
          throw new Error(message);
        }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\\n\\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame
            .split("\\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          try {
            handleEvent(JSON.parse(payload));
          } catch (err) {
            if (err instanceof Error && err.message !== "RUN_ERROR") {
              throw err;
            }
          }
        }
      }
      if (buf.trim()) {
        const dataLine = buf.split("\\n").find((l) => l.startsWith("data:"));
        if (dataLine) {
          try {
            handleEvent(JSON.parse(dataLine.slice(5).trim()));
          } catch {
            /* ignore */
          }
        }
      }
      syncAssistant();

      return {
        assistantMessage: {
          id: assistantId,
          role: "assistant",
          content: textBuffer,
          toolCalls,
        },
        toolCalls,
      };
    }
  }, [input, isRunning, runtimeUrl, threadId, copilotkit]);

  return (
    <div className="playground-chat-root">
      <div className="playground-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="playground-chat-empty">
            Start a conversation. The model can call any of your registered
            tools or actions; their renderers show up inline.
          </p>
        ) : (
          messages.map((m) => (
            <MessageView
              key={m.id}
              message={m}
              messages={messages}
              renderToolCall={renderToolCall}
            />
          ))
        )}
        {isRunning && (
          <div className="playground-chat-running" aria-label="streaming">
            …
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="playground-chat-error">
          {error}
        </div>
      )}
      <form
        className="playground-chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <input
          type="text"
          className="playground-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message…"
          disabled={isRunning}
          autoFocus
        />
        <button
          type="submit"
          className="playground-chat-send"
          disabled={isRunning || !input.trim()}
        >
          {isRunning ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

interface MessageViewProps {
  message: ChatMessage;
  messages: ChatMessage[];
  renderToolCall: (props: {
    toolCall: ToolCall;
    toolMessage?: ChatMessage;
  }) => React.ReactElement | null;
}

function MessageView({
  message,
  messages,
  renderToolCall,
}: MessageViewProps): React.ReactElement | null {
  if (message.role === "user") {
    return (
      <div className="playground-chat-bubble playground-chat-bubble-user">
        {message.content}
      </div>
    );
  }

  if (message.role === "assistant") {
    return (
      <div className="playground-chat-bubble playground-chat-bubble-assistant">
        {message.content ? (
          <div className="playground-chat-text">{message.content}</div>
        ) : null}
        {(message.toolCalls ?? []).map((tc) => {
          const toolMessage = messages.find(
            (m) => m.role === "tool" && m.toolCallId === tc.id,
          );
          const rendered = renderToolCall({ toolCall: tc, toolMessage });
          return (
            <div className="playground-chat-toolcall" key={tc.id}>
              <header className="playground-chat-toolcall-header">
                <code>{tc.function.name}</code>
              </header>
              {rendered ?? (
                <pre className="playground-chat-toolcall-args">
                  {tc.function.arguments}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Tool result messages: only render if no assistant tool call render
  // already covered them.
  if (message.role === "tool") {
    const owningAssistant = messages.find(
      (m) =>
        m.role === "assistant" &&
        (m.toolCalls ?? []).some((tc) => tc.id === message.toolCallId),
    );
    if (owningAssistant) return null;
    return (
      <div className="playground-chat-bubble playground-chat-bubble-meta">
        <small>[tool]</small> {message.content}
      </div>
    );
  }

  return null;
}
`.trimStart();
