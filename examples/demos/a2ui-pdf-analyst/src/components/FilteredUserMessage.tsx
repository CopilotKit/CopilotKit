"use client";

/**
 * Hides the body of attached PDFs from the chat history.
 *
 * When CopilotChat ships a multimodal user message, the user message renderer
 * concatenates every text-shaped part (including `document` parts whose
 * `source.value` is the extracted PDF text). The result is a wall of raw PDF
 * text below the user's typed prompt. We rewrite the message so each
 * `document` part is replaced by a single line `📎 <filename>` placeholder.
 *
 * The wire message that actually reaches the agent is untouched. this
 * only affects display.
 */
import { CopilotChatUserMessage } from "@copilotkit/react-core/v2";
import type { ComponentProps } from "react";
import type {
  UserMessage,
  InputContentPart,
  TextInputContent,
} from "@ag-ui/core";

type Props = ComponentProps<typeof CopilotChatUserMessage>;

function isDocumentPart(
  p: InputContentPart,
): p is Extract<InputContentPart, { type: "document" }> {
  return (
    typeof p === "object" &&
    p !== null &&
    (p as { type?: string }).type === "document"
  );
}

function filename(p: Extract<InputContentPart, { type: "document" }>): string {
  const meta = (p as { metadata?: { filename?: string } }).metadata;
  return meta?.filename ?? "attached document";
}

/* The Python multimodal middleware rewrites the original `document` part
 * into a `text` part prefixed with `[Document: <filename>]\n`. That string
 * round-trips back through the agent's messages_snapshot and lands here as
 * `message.content: string`. So we have to handle BOTH the array case (raw
 * message before it round-trips) AND the string case (after). */
const DOC_HEADER = /\[Document:\s*([^\]]+)\]\s*/;

function rewriteString(content: string): string {
  const m = content.match(DOC_HEADER);
  if (!m) return content;
  const before = content.slice(0, m.index ?? 0).trim();
  const fname = m[1]?.trim() || "attached document";
  return before ? `${before}\n📎 ${fname}` : `📎 ${fname}`;
}

function isInlinedDocText(p: InputContentPart): boolean {
  // The Python multimodal middleware turns text-shaped documents into
  // a TEXT input part prefixed with `[Document: filename]\n<text>`.
  // After a state round-trip that part lands here as a text part .
  // not a document part. so we have to sniff its text content.
  if (typeof p !== "object" || p === null) return false;
  if ((p as { type?: string }).type !== "text") return false;
  const text = (p as { text?: unknown }).text;
  return typeof text === "string" && DOC_HEADER.test(text);
}

function extractFilenameFromText(text: string): string {
  const m = text.match(DOC_HEADER);
  return m?.[1]?.trim() || "attached document";
}

function rewrite(message: UserMessage): UserMessage {
  // Case 1: original multimodal array. replace document parts with a
  // small placeholder text part. Also handle text parts that have
  // already been inlined as `[Document: ...]\n<body>` by the agent
  // round-trip. those leak the PDF body otherwise.
  if (Array.isArray(message.content)) {
    const rewritten: InputContentPart[] = [];
    for (const part of message.content) {
      if (isDocumentPart(part)) {
        rewritten.push({
          type: "text",
          text: `📎 ${filename(part)}`,
        } satisfies TextInputContent);
      } else if (isInlinedDocText(part)) {
        const text = (part as { text: string }).text;
        rewritten.push({
          type: "text",
          text: `📎 ${extractFilenameFromText(text)}`,
        } satisfies TextInputContent);
      } else {
        rewritten.push(part);
      }
    }
    return { ...message, content: rewritten };
  }
  // Case 2: stringified (after agent round-trip). strip the
  // `[Document: <fname>]\n<text…>` blob and keep just the user's prompt.
  if (typeof message.content === "string") {
    const next = rewriteString(message.content);
    if (next === message.content) return message;
    return { ...message, content: next };
  }
  return message;
}

function FilteredUserMessageImpl(props: Props) {
  return <CopilotChatUserMessage {...props} message={rewrite(props.message)} />;
}

// Slot expects `typeof CopilotChatUserMessage` (a component + its static
// namespace). We only override the render. the namespace is the same.
export const FilteredUserMessage = Object.assign(
  FilteredUserMessageImpl,
  CopilotChatUserMessage,
) as typeof CopilotChatUserMessage;
