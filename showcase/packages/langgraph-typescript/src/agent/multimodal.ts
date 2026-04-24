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
 * substitute a short text marker — Node-side PDF text extraction is not
 * wired in this graph, so the model is told a PDF was attached but cannot
 * read its contents directly. Wire `pdf-parse` or similar here later if
 * deeper PDF understanding is needed.
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
 * `document` parts (PDFs) are replaced with a short text marker since
 * we don't run server-side PDF text extraction in this TypeScript port.
 * Plain text passes through unchanged.
 */
function rewritePart(part: unknown): unknown {
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
  if (p.type === "document") {
    const mime = p.source?.mimeType ?? "";
    return {
      type: "text",
      text: `[Attached document${mime ? ` (${mime})` : ""}: contents not extracted server-side; describe what you can infer from the filename/type if asked.]`,
    };
  }
  return part;
}

function rewriteMessages(messages: BaseMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (!(message instanceof HumanMessage)) return message;
    const content = message.content;
    if (!Array.isArray(content)) return message;
    const rewritten = content.map(rewritePart);
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
  });
}

async function chatNode(state: AgentState, config: RunnableConfig) {
  // gpt-4o is the vision-capable default; temperature kept low for
  // deterministic image-Q&A behavior.
  const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });

  const messages = rewriteMessages(state.messages);

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
