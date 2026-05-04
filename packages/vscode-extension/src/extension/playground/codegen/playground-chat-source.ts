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
    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setIsRunning(true);

    const runId = uuid();
    const assistantId = uuid();
    let assistantBuffer = "";
    let assistantToolCalls: ToolCall[] = [];
    let assistantInserted = false;

    function ensureAssistant(): void {
      if (assistantInserted) return;
      assistantInserted = true;
      setMessages((m) => [
        ...m,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          toolCalls: [],
        },
      ]);
    }

    function syncAssistant(): void {
      ensureAssistant();
      const snapshotToolCalls = assistantToolCalls.map((tc) => ({
        ...tc,
        function: { ...tc.function },
      }));
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: assistantBuffer,
                toolCalls: snapshotToolCalls,
              }
            : msg,
        ),
      );
    }

    try {
      // eslint-disable-next-line no-console
      console.log(\`[playground-chat] POST \${runtimeUrl}/agent/\${DEFAULT_AGENT_ID}/run\`);
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
            messages: updatedMessages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
              ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
            })),
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        },
      );

      if (!res.ok || !res.body) {
        throw new Error(\`runtime returned \${res.status}\`);
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
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          handleAgUiEvent(event);
        }
      }
      // Drain any final buffered frame without trailing blank line.
      if (buf.trim()) {
        const dataLine = buf.split("\\n").find((l) => l.startsWith("data:"));
        if (dataLine) {
          try {
            handleAgUiEvent(JSON.parse(dataLine.slice(5).trim()));
          } catch {
            /* ignore */
          }
        }
      }
      syncAssistant();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[playground-chat] send failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }

    function handleAgUiEvent(event: Record<string, unknown>): void {
      const type = event.type as string | undefined;
      // Text deltas come as either TEXT_MESSAGE_CHUNK (single events) or
      // TEXT_MESSAGE_CONTENT (within START/CONTENT/END trios). Both have
      // \`delta\`. Accumulate.
      if (
        type === "TEXT_MESSAGE_CHUNK" ||
        type === "TEXT_MESSAGE_CONTENT"
      ) {
        const delta = event.delta as string | undefined;
        if (typeof delta === "string") {
          assistantBuffer += delta;
          syncAssistant();
        }
        return;
      }
      if (type === "TOOL_CALL_START") {
        const id = event.toolCallId as string;
        const name = event.toolCallName as string;
        assistantToolCalls.push({
          id,
          type: "function",
          function: { name, arguments: "" },
        });
        syncAssistant();
        return;
      }
      if (type === "TOOL_CALL_ARGS") {
        const id = event.toolCallId as string;
        const delta = event.delta as string | undefined;
        const tc = assistantToolCalls.find((t) => t.id === id);
        if (tc && typeof delta === "string") {
          tc.function.arguments += delta;
          syncAssistant();
        }
        return;
      }
      if (type === "TOOL_CALL_RESULT") {
        const toolCallId = event.toolCallId as string;
        const content =
          typeof event.content === "string"
            ? (event.content as string)
            : JSON.stringify(event.content ?? null);
        setMessages((m) => [
          ...m,
          {
            id: uuid(),
            role: "tool",
            content,
            toolCallId,
          },
        ]);
        return;
      }
      // RUN_STARTED, RUN_FINISHED, RUN_ERROR, STATE_*, MESSAGES_*, etc.
      // are intentionally ignored — they don't drive the chat surface.
      if (type === "RUN_ERROR") {
        const message = (event.message as string | undefined) ?? "RUN_ERROR";
        setError(message);
      }
    }
  }, [input, isRunning, runtimeUrl, threadId]);

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
