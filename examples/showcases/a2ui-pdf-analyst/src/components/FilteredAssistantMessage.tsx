"use client";

/**
 * Defensive sanitizer for assistant messages.
 *
 * The dynamic agent's system prompt instructs it to never emit prose
 * (the rendered surface is the answer), but if a model decides to dump
 * a verbatim PDF chunk into its chat reply anyway, we don't want a wall
 * of legalese surfacing in the chat. This slot strips any text that
 * looks like a PDF body. long uninterrupted paragraphs, repeated
 * disclaimer phrases, or content prefixed with a `[Document: …]`
 * header. and replaces it with a small note.
 *
 * The wire message is untouched; this only affects display.
 */
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof CopilotChatAssistantMessage>;

const DOC_HEADER = /\[Document:\s*[^\]]+\]\s*/;

/* Phrases that effectively only show up when the model has dumped raw
 * PDF text (boilerplate disclaimers, footers, SEC fine-print). If any
 * of these appear in a chat reply, it's near-certainly a PDF quote and
 * not a legitimate assistant message. suppress it regardless of length.
 * Keep this list narrow and PDF-flavored so we don't accidentally swallow
 * real model output. */
const PDF_BOILERPLATE = [
  /forward[- ]looking statement/i,
  /disclaims any obligation/i,
  /all rights reserved/i,
  /this (?:report|presentation) (?:contains|may contain)/i,
  /\bgaap\b.*\bnon[- ]?gaap\b/i,
  /safe harbor/i,
  /pursuant to (?:section|the)/i,
];

/* For longer messages without those phrases, fall back to a generic
 * "wall of unstructured prose" heuristic. */
const PROSE_MAX_CHARS = 600;

function looksLikePdfDump(text: string): boolean {
  if (DOC_HEADER.test(text)) return true;
  if (PDF_BOILERPLATE.some((re) => re.test(text))) return true;
  if (text.length < PROSE_MAX_CHARS) return false;
  // No markdown + very long → probably a PDF body the model echoed.
  const hasMarkdown = /[#`*_>-]/.test(text);
  return !hasMarkdown;
}

/* When the dynamic agent slips and echoes a tool's JSON return value
 * into chat (most often the query_pdf result, shape
 * { shape_hint, title, summary, data }), we don't want that JSON
 * showing up as the assistant's message. The surface in the canvas IS
 * the answer; chat should stay empty. Detect a message whose trimmed
 * content is a JSON object (optionally fenced in ```json) and suppress. */
function looksLikeJsonDump(text: string): boolean {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function sanitize(content: unknown): string {
  if (typeof content !== "string")
    return content == null ? "" : String(content);
  if (looksLikePdfDump(content)) return "";
  if (looksLikeJsonDump(content)) return "";
  // Even if not a full dump, strip a stray document header if present.
  return content.replace(DOC_HEADER, "").trim();
}

function FilteredAssistantMessageImpl(props: Props) {
  const original = props.message;
  const cleanedContent = sanitize(original.content);
  if (cleanedContent === original.content) {
    return <CopilotChatAssistantMessage {...props} />;
  }
  return (
    <CopilotChatAssistantMessage
      {...props}
      message={{ ...original, content: cleanedContent }}
    />
  );
}

export const FilteredAssistantMessage = Object.assign(
  FilteredAssistantMessageImpl,
  CopilotChatAssistantMessage,
) as typeof CopilotChatAssistantMessage;
