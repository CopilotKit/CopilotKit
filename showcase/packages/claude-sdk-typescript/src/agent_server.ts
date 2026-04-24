/**
 * Agent Server for Claude Agent SDK (TypeScript)
 *
 * Express server that hosts a Claude-powered agent backend.
 * The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
 */

// Cold-start instrumentation: emitted before any side-effect imports so
// Railway logs reveal exactly which phase (module load, Anthropic SDK
// init, express.listen) consumes the watchdog budget. Paired with the
// `[entrypoint] pre-node ...` print in entrypoint.sh so timestamps chain.
// Disambiguates the observed failure class where process claims to be
// listening but /health probes never succeed.
console.log(`[agent_server] module loaded ${new Date().toISOString()}`);

import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { EventEncoder } from "@ag-ui/encoder";
import { EventType, RunAgentInput, Message } from "@ag-ui/core";
import * as dotenv from "dotenv";
import { randomUUID } from "crypto";
import { BYOC_JSON_RENDER_SYSTEM_PROMPT } from "./agent/byoc-json-render-prompt";
import { BYOC_HASHBROWN_SYSTEM_PROMPT } from "./agent/byoc-hashbrown-prompt";
import {
  AGENT_CONFIG_DEFAULT_SYSTEM_PROMPT,
  buildAgentConfigSystemPrompt,
} from "./agent/agent-config-prompt";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
// Increase payload limit so base64-encoded attachments (images, PDFs) up
// to the frontend's 10MB cap fit inside the request body.
app.use(express.json({ limit: "20mb" }));

const HOST = process.env.AGENT_HOST || "0.0.0.0";
const PORT = parseInt(process.env.AGENT_PORT || "8000", 10);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-20241022";
// Vision-capable model used by the multimodal demo only. Anthropic's
// Haiku 3.5 has no vision; Sonnet 3.5 supports image + document parts.
const CLAUDE_VISION_MODEL =
  process.env.CLAUDE_VISION_MODEL || "claude-3-5-sonnet-20241022";

console.log(`[agent_server] pre-Anthropic ${new Date().toISOString()}`);
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log("[agent_server] Initializing Claude agent server");
console.log(`[agent_server] Model: ${CLAUDE_MODEL}`);
console.log(
  `[agent_server] ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET"}`,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an AG-UI `binary` content part into an Anthropic ContentBlock.
 * Returns `null` if the part cannot be mapped (unsupported mime/no payload).
 *
 * Claude's Messages API accepts `image` and `document` blocks natively;
 * images use `source: { type: "base64", media_type, data }` and PDFs use
 * `type: "document"` with the same source shape. URL-backed parts are
 * mapped to `source: { type: "url", url }`.
 */
function binaryPartToAnthropic(part: {
  type: "binary";
  mimeType: string;
  data?: string;
  url?: string;
}): Anthropic.ContentBlockParam | null {
  const mime = part.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || mime.toLowerCase().includes("pdf");

  if (!isImage && !isPdf) return null;

  if (part.data) {
    if (isImage) {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mime as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data: part.data,
        },
      };
    }
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: part.data,
      },
    };
  }

  if (part.url) {
    if (isImage) {
      return {
        type: "image",
        source: { type: "url", url: part.url },
      };
    }
    return {
      type: "document",
      source: { type: "url", url: part.url },
    };
  }

  return null;
}

function buildAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const raw = (msg as any).content;
      if (Array.isArray(raw)) {
        // AG-UI content parts — map text + binary to Anthropic blocks.
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const part of raw) {
          if (!part || typeof part !== "object") continue;
          if (part.type === "text" && typeof part.text === "string") {
            blocks.push({ type: "text", text: part.text });
          } else if (part.type === "binary") {
            const mapped = binaryPartToAnthropic(part);
            if (mapped) blocks.push(mapped);
          }
        }
        // Guard: Anthropic rejects user messages with empty content.
        if (blocks.length === 0) {
          blocks.push({ type: "text", text: "" });
        }
        result.push({ role: "user", content: blocks });
      } else {
        result.push({
          role: "user",
          content: raw ?? "",
        });
      }
    } else if (msg.role === "assistant") {
      const toolCalls = (msg as any).toolCalls as
        | Array<{ id: string; function: { name: string; arguments: string } }>
        | undefined;

      if (toolCalls && toolCalls.length > 0) {
        const content: Anthropic.ContentBlock[] = [];

        const textContent = (msg as any).content;
        if (textContent) {
          content.push({ type: "text", text: textContent, citations: null });
        }

        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            // leave empty
          }
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }

        result.push({ role: "assistant", content });
      } else {
        result.push({
          role: "assistant",
          content: (msg as any).content ?? "",
        });
      }
    } else if (msg.role === "tool") {
      const toolMsg = msg as any;
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolMsg.toolCallId ?? "",
            content:
              typeof toolMsg.content === "string"
                ? toolMsg.content
                : JSON.stringify(toolMsg.content),
          },
        ],
      });
    }
    // skip "system" and "developer" roles — handled separately as system prompt
  }

  return result;
}

function buildTools(tools: RunAgentInput["tools"]): Anthropic.Tool[] {
  if (!tools || tools.length === 0) return [];

  return tools.map((tool) => {
    let inputSchema: Anthropic.Tool.InputSchema = {
      type: "object",
      properties: {},
    };
    if (tool.parameters) {
      try {
        const parsed =
          typeof tool.parameters === "string"
            ? JSON.parse(tool.parameters)
            : tool.parameters;
        inputSchema = parsed as Anthropic.Tool.InputSchema;
      } catch {
        // use empty schema
      }
    }
    return {
      name: tool.name,
      description: tool.description ?? "",
      input_schema: inputSchema,
    };
  });
}

/**
 * Does the user messages contain any binary parts? Used to route the run
 * to the vision-capable Sonnet model instead of the default Haiku.
 */
function messagesHaveAttachments(messages: Message[]): boolean {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const content = (msg as any).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && part.type === "binary") {
        return true;
      }
    }
  }
  return false;
}

interface DemoConfig {
  /** Fixed system prompt. Overridden by `buildSystemPrompt` when provided. */
  systemPrompt?: string;
  /**
   * When present, takes precedence over `systemPrompt` and can read the
   * per-run `forwardedProps` to compose a dynamic prompt (used by
   * the agent-config demo).
   */
  buildSystemPrompt?: (forwardedProps: Record<string, unknown>) => string;
  /** Force vision-capable model regardless of attachment detection. */
  forceVisionModel?: boolean;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant powered by Anthropic's Claude.";

// ---------------------------------------------------------------------------
// AG-UI streaming endpoint factory
// ---------------------------------------------------------------------------

function makeAgentHandler(config: DemoConfig = {}) {
  return async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RunAgentInput;
    const accept = req.headers["accept"] ?? "";

    const encoder = new EventEncoder({ accept });
    res.setHeader("Content-Type", encoder.getContentType());
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = input.runId ?? randomUUID();
    const threadId = input.threadId ?? randomUUID();
    const msgId = randomUUID();

    const emit = (event: object) => {
      res.write(encoder.encodeSSE(event as any));
    };

    try {
      emit({ type: EventType.RUN_STARTED, runId, threadId });

      const userMessages = input.messages ?? [];
      const messages = buildAnthropicMessages(userMessages);
      const tools = buildTools(input.tools);

      const forwardedProps = ((input as any).forwardedProps ?? {}) as Record<
        string,
        unknown
      >;

      // Resolve the system prompt.
      let systemPrompt = DEFAULT_SYSTEM_PROMPT;
      if (config.buildSystemPrompt) {
        systemPrompt = config.buildSystemPrompt(forwardedProps);
      } else if (config.systemPrompt) {
        systemPrompt = config.systemPrompt;
      }

      if (input.context && input.context.length > 0) {
        const contextStr = input.context
          .map((c: any) => `${c.description}: ${c.value}`)
          .join("\n");
        systemPrompt += `\n\nContext:\n${contextStr}`;
      }

      const useVision =
        config.forceVisionModel || messagesHaveAttachments(userMessages);
      const model = useVision ? CLAUDE_VISION_MODEL : CLAUDE_MODEL;

      const claudeRequest: Anthropic.MessageCreateParamsStreaming = {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
      };

      const stream = await anthropic.messages.stream(claudeRequest);

      let toolCallId: string | null = null;
      let toolCallName: string | null = null;
      let toolCallArgs = "";
      let textMessageStarted = false;

      for await (const event of stream) {
        if (event.type === "message_start") {
          // wait for text_delta to emit TEXT_MESSAGE_START
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            toolCallId = event.content_block.id;
            toolCallName = event.content_block.name;
            toolCallArgs = "";
            emit({
              type: EventType.TOOL_CALL_START,
              toolCallId,
              toolCallName,
              parentMessageId: msgId,
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            if (!textMessageStarted) {
              emit({
                type: EventType.TEXT_MESSAGE_START,
                messageId: msgId,
                role: "assistant",
              });
              textMessageStarted = true;
            }
            emit({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: msgId,
              delta: event.delta.text,
            });
          } else if (event.delta.type === "input_json_delta") {
            toolCallArgs += event.delta.partial_json;
            emit({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId,
              delta: event.delta.partial_json,
            });
          }
        } else if (event.type === "content_block_stop") {
          if (toolCallId) {
            emit({
              type: EventType.TOOL_CALL_END,
              toolCallId,
            });
            toolCallId = null;
            toolCallName = null;
            toolCallArgs = "";
          }
        } else if (event.type === "message_stop") {
          if (textMessageStarted) {
            emit({
              type: EventType.TEXT_MESSAGE_END,
              messageId: msgId,
            });
          }
        }
      }

      emit({ type: EventType.RUN_FINISHED, runId, threadId });
    } catch (error: unknown) {
      const err = error as Error;
      console.error(`[agent_server] ERROR: ${err.message}`);
      emit({
        type: EventType.RUN_ERROR,
        runId,
        threadId,
        message: err.message,
        code: "AGENT_ERROR",
      });
    }

    res.end();
  };
}

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

// Default pass-through agent.
app.post("/", makeAgentHandler());

// BYOC demos — each has its own system prompt that instructs Claude to
// emit structured JSON consumed by the dedicated frontend renderer.
app.post(
  "/byoc-json-render",
  makeAgentHandler({ systemPrompt: BYOC_JSON_RENDER_SYSTEM_PROMPT }),
);
app.post(
  "/byoc-hashbrown",
  makeAgentHandler({ systemPrompt: BYOC_HASHBROWN_SYSTEM_PROMPT }),
);

// Multimodal — always use the vision model so images + PDFs work.
app.post(
  "/multimodal",
  makeAgentHandler({
    systemPrompt:
      "You are a helpful assistant. The user may attach images or documents (PDFs). " +
      "When they do, analyze the attachment carefully and answer the user's question. " +
      "If no attachment is present, answer the text question normally. Keep responses " +
      "concise (1-3 sentences) unless asked to go deep.",
    forceVisionModel: true,
  }),
);

// Agent-config — dynamic system prompt built from forwardedProps.
app.post(
  "/agent-config",
  makeAgentHandler({
    buildSystemPrompt: (fp) =>
      buildAgentConfigSystemPrompt(fp) || AGENT_CONFIG_DEFAULT_SYSTEM_PROMPT,
  }),
);

// Auth and voice reuse the default pass-through — the gate / transcription
// service lives on the Next.js route, not the agent itself.

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    model: CLAUDE_MODEL,
    vision_model: CLAUDE_VISION_MODEL,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
  });
});

app.listen(PORT, HOST, () => {
  console.log(
    `[agent_server] listening ${new Date().toISOString()} http://${HOST}:${PORT}`,
  );
});
