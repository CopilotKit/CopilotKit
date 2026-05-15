/**
 * Multimodal LangGraph TypeScript agent — accepts image + document (PDF)
 * attachments scoped to the `/demos/multimodal` cell.
 *
 * Uses a *dedicated* vision-capable graph (gpt-4o) so other demos continue
 * to use cheaper, text-only models. Inputs forwarded by the runtime:
 *   - `{"type": "text", "text": "..."}`
 *   - `{"type": "image", "source": {"type": "data", "value": "<base64>",
 *      "mimeType": "image/png"}}`
 *   - `{"type": "document", "source": {"type": "data", "value": "<base64>",
 *      "mimeType": "application/pdf"}}`
 *
 * gpt-4o consumes `image` parts natively. For `document` parts (PDFs) we
 * extract text server-side via `pdf-parse` and inline it as a text part
 * with a clear delimiter — matching the Python reference's `pypdf`-backed
 * extraction so the TS multimodal demo reaches feature parity.
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
  source?: { type?: string; value?: string; mimeType?: string };
  [k: string]: unknown;
}

/**
 * Rewrite a multimodal content part into a shape the OpenAI chat API
 * understands. Images are converted to OpenAI's `image_url` data-URL parts.
 * PDF `document` parts have their text extracted server-side via `pdf-parse`
 * and inlined. Plain text passes through unchanged.
 */
async function rewritePart(part: unknown): Promise<unknown> {
  if (!part || typeof part !== "object") return part;
  const p = part as ContentPart;
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
    if (mime === "application/pdf" && value) {
      try {
        // Strip data: prefix if present, then base64-decode.
        const base64 = value.startsWith("data:")
          ? value.slice(value.indexOf(",") + 1)
          : value;
        const buffer = Buffer.from(base64, "base64");
        const parsed = await pdfParse(buffer);
        const text = parsed.text.trim();
        if (text) {
          return {
            type: "text",
            text:
              `[Attached PDF (${parsed.numpages} page${parsed.numpages === 1 ? "" : "s"}) — extracted text follows]\n\n` +
              text,
          };
        }
      } catch (err) {
        // Fall through to the generic marker below on extraction failure.
        const message = err instanceof Error ? err.message : String(err);
        return {
          type: "text",
          text: `[Attached PDF — server-side extraction failed: ${message}]`,
        };
      }
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
