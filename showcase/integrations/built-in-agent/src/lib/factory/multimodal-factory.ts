import type { TanStackChatMessage } from "@copilotkit/runtime/v2";
import { extractText, getDocumentProxy } from "unpdf";
import { createBuiltInAgent } from "./tanstack-factory";

// Built-in agent for the Multimodal Attachments demo.
//
// The base built-in agent (gpt-5.4) consumes image `document`/`image` content
// parts natively via its vision adapter, but the OpenAI TEXT adapter cannot
// consume PDF `document` parts — the turn is dropped before the model is even
// called (aimock records zero PDF requests). LGP solves this by flattening
// PDFs to text server-side with `pypdf`; BIA (TypeScript) has no equivalent, so
// this factory does the same flatten with `unpdf` (a dependency-light pdf.js
// wrapper that runs in the Next.js Node server runtime) via the opt-in
// `preprocessMessages` hook. Scoped to this factory only — other demos keep the
// unmodified base agent.

/**
 * A `document`/`image` content part as produced by
 * `convertInputToTanStackAI` (`{ type, source: { type: "data" | "url",
 * value, mimeType } }`).
 */
interface DataSourcePart {
  type: string;
  source?: {
    type?: string;
    value?: string;
    mimeType?: string;
  };
}

function isPdfDocumentPart(part: unknown): part is DataSourcePart {
  if (!part || typeof part !== "object") return false;
  const p = part as DataSourcePart;
  if (p.type !== "document") return false;
  const mime = p.source?.mimeType ?? "";
  return typeof mime === "string" && mime.toLowerCase().includes("pdf");
}

/**
 * Normalise a `source.value` to raw base64. The demo inlines base64 with no
 * `data:` prefix (see `file-to-data-attachment.ts`), but a round-tripped
 * attachment can arrive as a `data:<mime>;base64,<payload>` URL, so strip the
 * prefix defensively.
 */
function toBase64Payload(value: string): string {
  if (!value.startsWith("data:")) return value;
  const commaIdx = value.indexOf(",");
  return commaIdx >= 0 ? value.slice(commaIdx + 1) : value;
}

/**
 * Extract text from an inline-base64 PDF. Returns "" on any failure so one
 * malformed attachment doesn't tank the turn — the caller emits a structured
 * placeholder in that case.
 */
async function extractPdfText(base64: string): Promise<string> {
  try {
    const bytes = new Uint8Array(
      Buffer.from(toBase64Payload(base64), "base64"),
    );
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return (typeof text === "string" ? text : text.join("\n\n")).trim();
  } catch (err) {
    console.error("[multimodal-factory] PDF extract failed:", err);
    return "";
  }
}

/**
 * Flatten PDF `document` parts on user messages to text parts the OpenAI text
 * adapter can consume. Images and every non-PDF part pass through untouched.
 * Duplicate PDF parts (the frontend shim appends a legacy `binary` mirror that
 * also converts to a `document` part) are de-duplicated by their base64 value
 * so the model sees each document once.
 */
async function flattenPdfParts(
  messages: TanStackChatMessage[],
): Promise<TanStackChatMessage[]> {
  const out: TanStackChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      out.push(message);
      continue;
    }
    let mutated = false;
    const seenPdfValues = new Set<string>();
    const newParts: unknown[] = [];
    for (const part of message.content) {
      if (!isPdfDocumentPart(part)) {
        newParts.push(part);
        continue;
      }
      mutated = true;
      const value = part.source?.value ?? "";
      const key = toBase64Payload(value);
      if (seenPdfValues.has(key)) continue; // drop duplicate mirror
      seenPdfValues.add(key);
      const text = await extractPdfText(value);
      newParts.push(
        text
          ? { type: "text", content: `[Attached document]\n${text}` }
          : {
              type: "text",
              content: "[Attached document: PDF could not be read.]",
            },
      );
    }
    out.push(mutated ? { ...message, content: newParts } : message);
  }
  return out;
}

export function createMultimodalAgent() {
  return createBuiltInAgent({ preprocessMessages: flattenPdfParts });
}
