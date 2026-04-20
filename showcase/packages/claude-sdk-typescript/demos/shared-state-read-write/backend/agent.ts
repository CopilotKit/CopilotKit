/**
 * Claude Agent SDK (TypeScript) agent backing the Agentic Chat cell.
 *
 * Pass-through architecture: CopilotKit frontend registers tools via
 * useFrontendTool/useRenderTool; the runtime forwards them here as AG-UI
 * tool definitions. When Claude emits tool_use, we re-emit as
 * TOOL_CALL_START/ARGS/END; the AG-UI client executes client-side and
 * re-invokes with the tool_result.
 */

import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { EventEncoder } from "@ag-ui/encoder";
import { BaseEvent, EventType, RunAgentInput, Message } from "@ag-ui/core";
import * as dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

const HOST = process.env.AGENT_HOST || "0.0.0.0";
const PORT = parseInt(process.env.AGENT_PORT || "8123", 10);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-20241022";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[agent] WARNING: ANTHROPIC_API_KEY is not set; requests will fail.",
  );
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "missing",
});

console.log("[agent] cell: claude-sdk-typescript / agentic-chat");
console.log(`[agent] model: ${CLAUDE_MODEL}`);

// ---------------------------------------------------------------------------
// AG-UI <-> Anthropic adapters
// ---------------------------------------------------------------------------

function buildAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      out.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const toolCalls = msg.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (msg.content) blocks.push({ type: "text", text: msg.content });
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch (e) {
            console.warn(`[agent] bad tool args ${tc.function?.name}: ${e}`);
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({ role: "assistant", content: msg.content ?? "" });
      }
    } else if (msg.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId ?? "",
            content:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
          },
        ],
      });
    }
  }
  return out;
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
        inputSchema =
          typeof tool.parameters === "string"
            ? (JSON.parse(tool.parameters) as Anthropic.Tool.InputSchema)
            : (tool.parameters as Anthropic.Tool.InputSchema);
      } catch (e) {
        console.warn(`[agent] bad schema for ${tool.name}: ${e}`);
      }
    }
    return {
      name: tool.name,
      description: tool.description ?? "",
      input_schema: inputSchema,
    };
  });
}

// ---------------------------------------------------------------------------
// AG-UI streaming endpoint
// ---------------------------------------------------------------------------

app.post("/", async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RunAgentInput;
  const encoder = new EventEncoder({ accept: req.headers["accept"] ?? "" });
  res.setHeader("Content-Type", encoder.getContentType());
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const runId = input.runId ?? randomUUID();
  const threadId = input.threadId ?? randomUUID();
  const msgId = randomUUID();
  const emit = (event: BaseEvent) => res.write(encoder.encodeSSE(event));

  try {
    emit({ type: EventType.RUN_STARTED, runId, threadId });

    const messages = buildAnthropicMessages(input.messages ?? []);
    const tools = buildTools(input.tools);

    let systemPrompt =
      "You are a helpful AI assistant powered by Anthropic's Claude.";
    if (input.context && input.context.length > 0) {
      systemPrompt +=
        "\n\nContext:\n" +
        input.context.map((c) => `${c.description}: ${c.value}`).join("\n");
    }

    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
    });

    let toolCallId: string | null = null;
    let textStarted = false;

    for await (const ev of stream) {
      if (ev.type === "content_block_start") {
        if (ev.content_block.type === "tool_use") {
          toolCallId = ev.content_block.id;
          emit({
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: ev.content_block.name,
            parentMessageId: msgId,
          });
        }
      } else if (ev.type === "content_block_delta") {
        if (ev.delta.type === "text_delta") {
          if (!textStarted) {
            emit({
              type: EventType.TEXT_MESSAGE_START,
              messageId: msgId,
              role: "assistant",
            });
            textStarted = true;
          }
          emit({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: msgId,
            delta: ev.delta.text,
          });
        } else if (ev.delta.type === "input_json_delta" && toolCallId) {
          emit({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: ev.delta.partial_json,
          });
        }
      } else if (ev.type === "content_block_stop") {
        if (toolCallId) {
          emit({ type: EventType.TOOL_CALL_END, toolCallId });
          toolCallId = null;
        }
      } else if (ev.type === "message_stop") {
        if (textStarted) {
          emit({ type: EventType.TEXT_MESSAGE_END, messageId: msgId });
        }
      }
    }

    emit({ type: EventType.RUN_FINISHED, runId, threadId });
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[agent] ERROR: ${err.message}`);
    try {
      emit({
        type: EventType.RUN_ERROR,
        runId,
        threadId,
        message: "An error occurred while processing the request",
        code: "AGENT_ERROR",
      });
    } catch {
      // client disconnected
    }
  }
  res.end();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: CLAUDE_MODEL });
});

app.listen(PORT, HOST, () => {
  console.log(`[agent] listening on http://${HOST}:${PORT}`);
});
