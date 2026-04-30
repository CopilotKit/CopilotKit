/**
 * Multimodal LangGraph TypeScript agent — accepts image + document (PDF)
 * attachments scoped to the `/demos/multimodal` cell.
 *
 * Uses a *dedicated* vision-capable graph (gpt-4o) so other demos continue
 * to use cheaper, text-only models.
 *
 * Content-part shapes the agent has to handle
 * --------------------------------------------
 * Modern AG-UI shape (primary, what CopilotChat emits):
 *   - `{ "type": "text", "text": "..." }`
 *   - `{ "type": "image",    "source": { "type": "data", "value": "<base64>", "mimeType": "image/png" } }`
 *   - `{ "type": "document", "source": { "type": "data", "value": "<base64>", "mimeType": "application/pdf" } }`
 *
 * Post-converter LangChain shape (what actually reaches the LangGraph
 * deployment after `@ag-ui/langgraph`'s `aguiMessagesToLangChain`
 * collapses every modern media type into LangChain's only multimodal
 * primitive):
 *   - `{ "type": "image_url", "image_url": { "url": "data:<mime>;base64,<payload>" } }`
 *
 * gpt-4o consumes `image_url` parts whose data URL has an `image/*` mime
 * type natively. PDFs cannot be ingested as images, so we detect the
 * `application/pdf` data URL and extract the text server-side via
 * `pdf-parse`, replacing the part with an inline text part. The modern
 * `document` shape is preserved as a fallback for any flow that
 * forwards AG-UI parts directly without going through the converter.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";
import pdfParse from "pdf-parse";

const SYSTEM_PROMPT =
  "You are a helpful assistant. The user may attach images or documents " +
  "(PDFs). When they do, analyze the attachment carefully and answer the " +
  "user's question. If no attachment is present, answer the text question " +
  "normally. Keep responses concise (1-3 sentences) unless asked to go deep.";

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

interface ContentPart {
  type?: string;
  text?: string;
  image_url?: string | { url?: string };
  source?: { type?: string; value?: string; mimeType?: string };
  [k: string]: unknown;
}

/** Parse a `data:<mime>;base64,<payload>` URL into its parts. */
function parseDataUrl(url: string): { mime: string; payload: string } | null {
  if (!url.startsWith("data:")) return null;
  const commaIdx = url.indexOf(",");
  if (commaIdx < 0) return null;
  const header = url.slice(5, commaIdx); // strip "data:"
  const payload = url.slice(commaIdx + 1);
  // header is "<mime>;base64" (we only ever emit base64 data URLs here).
  const mime = header.split(";", 1)[0] ?? "";
  if (!mime || !payload) return null;
  return { mime, payload };
}

/** Extract text from a base64-encoded PDF payload. Returns "" on failure. */
async function extractPdfText(base64Payload: string): Promise<{
  text: string;
  pages: number;
} | null> {
  try {
    const buffer = Buffer.from(base64Payload, "base64");
    const parsed = await pdfParse(buffer);
    return { text: parsed.text.trim(), pages: parsed.numpages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[multimodal_agent] pdf-parse failed: ${message}`);
    return null;
  }
}

/** Build a `[Attached PDF]` text part from extracted PDF text. */
function buildPdfTextPart(extracted: { text: string; pages: number } | null): {
  type: "text";
  text: string;
} {
  if (!extracted || !extracted.text) {
    return {
      type: "text",
      text: "[Attached document: PDF could not be read.]",
    };
  }
  const { text, pages } = extracted;
  return {
    type: "text",
    text:
      `[Attached PDF (${pages} page${pages === 1 ? "" : "s"}) — extracted text follows]\n\n` +
      text,
  };
}

/**
 * Rewrite a multimodal content part into a shape the OpenAI chat API
 * understands.
 *
 * - Post-converter `image_url` parts whose data URL is an image pass
 *   through unchanged (gpt-4o consumes them natively).
 * - Post-converter `image_url` parts whose data URL is a PDF have their
 *   text extracted server-side and are replaced with a text part.
 * - Modern AG-UI `image` parts are normalized to `image_url`.
 * - Modern AG-UI `document` parts (PDFs) have their text extracted
 *   server-side and are replaced with a text part.
 * - Plain text and unrecognized parts pass through unchanged.
 */
async function rewritePart(part: unknown): Promise<unknown> {
  if (!part || typeof part !== "object") return part;
  const p = part as ContentPart;

  // Post-converter LangChain shape (what `@ag-ui/langgraph` emits today).
  if (p.type === "image_url") {
    const url =
      typeof p.image_url === "string"
        ? p.image_url
        : (p.image_url?.url ?? "");
    const parsed = parseDataUrl(url);
    if (!parsed) return part;
    if (parsed.mime.startsWith("image/")) {
      return part;
    }
    if (parsed.mime.toLowerCase().includes("pdf")) {
      const extracted = await extractPdfText(parsed.payload);
      return buildPdfTextPart(extracted);
    }
    return part;
  }

  // Modern AG-UI shape — preserved for forward-compat / direct AG-UI flows
  // that bypass the LangChain converter.
  if (p.type === "image" && p.source?.type === "data") {
    const mime = p.source.mimeType ?? "image/png";
    const value = p.source.value ?? "";
    const dataUrl = value.startsWith("data:")
      ? value
      : `data:${mime};base64,${value}`;
    return {
      type: "image_url",
      image_url: { url: dataUrl },
    };
  }
  if (p.type === "document" && p.source?.type === "data") {
    const mime = p.source.mimeType ?? "";
    const value = p.source.value ?? "";
    if (mime.toLowerCase().includes("pdf") && value) {
      // Strip data: prefix if present, then base64-decode.
      const base64 = value.startsWith("data:")
        ? value.slice(value.indexOf(",") + 1)
        : value;
      const extracted = await extractPdfText(base64);
      return buildPdfTextPart(extracted);
    }
    return {
      type: "text",
      text: `[Attached document${mime ? ` (${mime})` : ""}: contents not extracted server-side; describe what you can infer from the filename/type if asked.]`,
    };
  }

  return part;
}

async function rewriteMessages(
  messages: BaseMessage[],
): Promise<BaseMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (!(message instanceof HumanMessage)) return message;
      const content = message.content;
      if (!Array.isArray(content)) return message;
      const rewritten = await Promise.all(content.map(rewritePart));
      if (
        rewritten.length === content.length &&
        rewritten.every((part, i) => part === content[i])
      ) {
        return message;
      }
      return new HumanMessage({
        content: rewritten as never,
        id: message.id,
      });
    }),
  );
}

async function chatNode(state: AgentState, config: RunnableConfig) {
  // gpt-4o is the vision-capable default; temperature kept low for
  // deterministic image-Q&A behavior.
  const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });

  const messages = await rewriteMessages(state.messages);

  const response = (await model.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...messages],
    config,
  )) as AIMessage;

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", "__end__");

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
