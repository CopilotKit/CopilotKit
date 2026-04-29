/**
 * Source string of the PlaygroundChat module written into the generated
 * playground entry directory at codegen time.
 *
 * Why a custom chat instead of @copilotkit/react-core/v2's `<CopilotChat />`?
 *
 * After multiple debug rounds we could not get CopilotChat's `onSubmitInput`
 * to actually fire `copilotkit.runAgent` against the in-process runtime —
 * the message rendered as sent locally but no POST ever hit the server.
 * Rather than continue chasing CopilotChat's subscription/license/state
 * surface (none of which the playground needs), the chat surface drives
 * the runtime directly. The user's hook registrations (useRenderTool,
 * useComponent, useCopilotAction, useFrontendTool, …) still register on
 * the real CopilotKitProvider that wraps this component, so when the
 * model emits a tool call we look it up via `useRenderToolCall()` —
 * the same hook CopilotChat's internals use — and render the user's
 * registered component inline.
 *
 * Why a string template? The component lives inside the user-bundled
 * IIFE so it can sit under the user's CopilotKitProvider in the React
 * tree. Same delivery pattern as `error-boundary-source.ts`.
 */
export const PLAYGROUND_CHAT_SOURCE = `
import * as React from "react";
import {
  useAgent,
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";

const DEFAULT_AGENT_ID = "default";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AnyMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "developer" | string;
  content?: string | unknown;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function PlaygroundChat(): React.ReactElement {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: DEFAULT_AGENT_ID });
  const renderToolCall = useRenderToolCall();

  const [messages, setMessages] = React.useState<AnyMessage[]>(
    () => (agent ? [...(agent.messages as AnyMessage[])] : []),
  );
  const [input, setInput] = React.useState("");
  const [isRunning, setIsRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Keep the list in sync with the agent's message store as the runtime
  // streams in deltas. Subscribing on (agent) means thread switches and
  // hot-reloads correctly resubscribe.
  React.useEffect(() => {
    if (!agent) return;
    setMessages([...(agent.messages as AnyMessage[])]);
    const sub = agent.subscribe({
      onMessagesChanged: (params: { messages: AnyMessage[] }) => {
        setMessages([...params.messages]);
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  const handleSend = React.useCallback(async () => {
    const text = input.trim();
    if (!text || !agent || isRunning) return;
    setError(null);
    setIsRunning(true);

    try {
      // Add the user message to the agent locally (this also fires
      // onNewMessage subscribers — same path CopilotChat uses).
      agent.addMessage({ id: uuid(), role: "user", content: text });
      setInput("");

      // Drive the run through the core's run handler so context, tools,
      // and forwardedProps are assembled the same way the rest of
      // CopilotKit expects.
      // eslint-disable-next-line no-console
      console.log("[playground-chat] runAgent ->");
      await copilotkit.runAgent({ agent });
      // eslint-disable-next-line no-console
      console.log("[playground-chat] runAgent <- complete");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[playground-chat] runAgent threw", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [agent, copilotkit, input, isRunning]);

  return (
    <div className="playground-chat-root">
      <div className="playground-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="playground-chat-empty">
            Start a conversation. The model can call any of your registered
            tools or actions; their renderers show up inline.
          </p>
        ) : (
          messages.map((m, i) => (
            <MessageView
              key={m.id ?? i}
              message={m}
              messages={messages}
              renderToolCall={renderToolCall}
            />
          ))
        )}
        {isRunning && (
          <div className="playground-chat-running">…</div>
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
          placeholder={agent ? "Send a message…" : "Connecting…"}
          disabled={!agent || isRunning}
          autoFocus
        />
        <button
          type="submit"
          className="playground-chat-send"
          disabled={!agent || isRunning || !input.trim()}
        >
          {isRunning ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

interface MessageViewProps {
  message: AnyMessage;
  messages: AnyMessage[];
  renderToolCall: (props: {
    toolCall: ToolCall;
    toolMessage?: AnyMessage;
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
        {renderContent(message.content)}
      </div>
    );
  }

  if (message.role === "assistant") {
    return (
      <div className="playground-chat-bubble playground-chat-bubble-assistant">
        {message.content ? (
          <div className="playground-chat-text">
            {renderContent(message.content)}
          </div>
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

  if (message.role === "tool") {
    // If a matching assistant tool call has a renderer registered, the
    // renderer above already showed the result. Skip the raw bubble in
    // that case to avoid duplicate UI.
    return null;
  }

  // system / developer / activity / reasoning — quiet by default in the
  // playground; surface as muted text so authors can see them while
  // testing without visual noise dominating.
  return (
    <div className="playground-chat-bubble playground-chat-bubble-meta">
      <small>[{message.role}]</small> {renderContent(message.content)}
    </div>
  );
}

function renderContent(content: unknown): React.ReactNode {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // Multimodal user content (text + image parts). Show text parts only.
    return content
      .map((part) => {
        if (part && typeof part === "object" && "type" in part) {
          const p = part as { type: string; text?: string; content?: string };
          if (p.type === "text") return p.text ?? p.content ?? "";
        }
        return "";
      })
      .join("");
  }
  return JSON.stringify(content);
}
`.trimStart();
