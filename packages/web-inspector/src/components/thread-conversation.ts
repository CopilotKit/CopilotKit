import { css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { ThreadDebuggerMessage } from "../index.js";

/** Readable text only; non-text content remains available in message details. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) => {
      if (typeof part !== "object" || part === null || !("text" in part))
        return [];
      return typeof part.text === "string" ? [part.text] : [];
    })
    .join("\n");
}

/** Formats recorded data as text, explicitly marking values JSON cannot represent. */
function payloadText(value: unknown): string {
  if (typeof value === "string") {
    const recordedText = value;
    try {
      value = JSON.parse(value);
    } catch {
      return recordedText;
    }
  }
  const ancestors: object[] = [];
  try {
    return (
      JSON.stringify(
        value,
        function (this: unknown, _key, current: unknown) {
          if (typeof current === "bigint") return `[BigInt: ${current}]`;
          if (typeof current === "undefined") return "[Undefined value]";
          if (typeof current === "function") return "[Function value]";
          if (typeof current === "symbol")
            return `[Symbol value: ${String(current)}]`;
          if (typeof current === "number" && !Number.isFinite(current))
            return `[Non-finite number: ${current}]`;
          if (typeof current !== "object" || current === null) return current;
          // Track ancestors, not every seen object: repeated siblings are valid JSON.
          while (ancestors.length > 0 && ancestors.at(-1) !== this)
            ancestors.pop();
          if (ancestors.includes(current)) return "[Circular reference]";
          ancestors.push(current);
          return current;
        },
        2,
      ) ?? "[Undefined value]"
    );
  } catch {
    // Providers may also supply throwing accessors/toJSON methods. Keep the
    // rest of the read-only record visible without pretending this value is empty.
    return "[Unable to display this recorded value as JSON]";
  }
}

/** Canonical message order, including non-chat roles and unmatched tool results. */
export function renderThreadConversation(
  messages: readonly ThreadDebuggerMessage[],
) {
  const toolNames = new Map(
    messages.flatMap(
      (message) =>
        message.toolCalls?.map((call) => [call.id, call.name] as const) ?? [],
    ),
  );
  return html`<div class="cpk-conversation">
    ${repeat(
      messages,
      (message, index) => `${message.id}:${index}`,
      (message) => {
        const isChat = message.role === "user" || message.role === "assistant";
        const label =
          message.role === "user"
            ? "User"
            : message.role === "assistant"
              ? "Assistant"
              : message.role === "tool"
                ? "Tool result"
                : message.role === "activity"
                  ? "App activity"
                  : message.role;
        const text = messageText(message.content);
        return html`<article class="cpk-conversation-message ${message.role === "user" ? "cpk-conversation-message--user" : ""}" data-message-id=${message.id} aria-label=${`${label} message`}>
        <div class="cpk-conversation-role">${label}</div>
        ${isChat && text ? html`<div class="cpk-conversation-text">${text}</div>` : nothing}
        ${
          isChat &&
          typeof message.content !== "string" &&
          message.content != null
            ? html`
                <p class="cpk-conversation-hint">
                  Rich content is preserved in message details.
                </p>
              `
            : nothing
        }
        ${message.toolCalls?.map((call) => html`<details class="cpk-conversation-disclosure"><summary>Tool call: ${call.name}</summary><pre>${payloadText(call.args)}</pre></details>`)}
        ${!isChat ? html`<details class="cpk-conversation-disclosure"><summary>${message.role === "activity" ? (message.activityType ?? "App activity payload") : message.role === "tool" ? `Recorded result${message.toolCallId && toolNames.has(message.toolCallId) ? `: ${toolNames.get(message.toolCallId)}` : ""}` : "Recorded content"}</summary><pre>${payloadText(message.content)}</pre></details>` : nothing}
        <details class="cpk-conversation-disclosure cpk-conversation-disclosure--raw"><summary>Message details</summary><pre>${payloadText(message)}</pre></details>
      </article>`;
      },
    )}
  </div>`;
}

export const threadConversationStyles = css`
  .cpk-conversation,
  .cpk-conversation * {
    box-sizing: border-box;
  }
  .cpk-conversation {
    display: flex;
    flex-direction: column;
    gap: 18px;
    width: 100%;
    max-width: 800px;
    margin-inline: auto;
  }
  .cpk-conversation-message {
    align-self: flex-start;
    width: min(92%, 680px);
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid #e5e5ed;
    border-radius: 14px;
    background: #fff;
    color: #262630;
  }
  .cpk-conversation-message--user {
    align-self: flex-end;
    background: #f0edff;
    border-color: #e0daf8;
  }
  .cpk-conversation-role {
    font-size: 11px;
    font-weight: 600;
    color: #62606e;
    margin-bottom: 7px;
  }
  .cpk-conversation-text {
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .cpk-conversation-hint {
    font-size: 12px;
    line-height: 1.5;
    color: #68686e;
    margin: 6px 0;
  }
  .cpk-conversation-disclosure {
    margin-top: 8px;
    font-size: 12px;
    min-width: 0;
  }
  .cpk-conversation-disclosure summary {
    cursor: pointer;
    padding: 5px 0;
    overflow-wrap: anywhere;
  }
  .cpk-conversation-disclosure summary:focus-visible {
    outline: 2px solid #5558b2;
    outline-offset: 2px;
    border-radius: 3px;
  }
  .cpk-conversation-disclosure pre {
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding: 10px;
    border-radius: 6px;
    background: #f7f7fa;
    max-height: 360px;
    overflow-y: auto;
  }
  .cpk-conversation-disclosure--raw {
    color: #68686e;
    font-size: 11px;
  }
  .cpk-conversation-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    width: 100%;
    max-width: 800px;
    margin: 0 auto 18px;
    font-size: 12px;
    color: #68686e;
  }
  .cpk-conversation-heading p {
    margin: 0;
  }
  :host([data-color-scheme="dark"]) .cpk-conversation-message {
    background: #1d2028;
    border-color: #363945;
    color: #f3f4f8;
  }
  :host([data-color-scheme="dark"]) .cpk-conversation-message--user {
    background: #312d48;
    border-color: #49405e;
  }
  :host([data-color-scheme="dark"]) .cpk-conversation-role,
  :host([data-color-scheme="dark"]) .cpk-conversation-hint,
  :host([data-color-scheme="dark"]) .cpk-conversation-heading,
  :host([data-color-scheme="dark"]) .cpk-conversation-disclosure--raw {
    color: #b6b6c4;
  }
  :host([data-color-scheme="dark"]) .cpk-conversation-disclosure pre {
    background: #111319;
  }
  @media (max-width: 600px) {
    .cpk-conversation-message {
      width: 96%;
      padding: 12px;
    }
  }
`;
