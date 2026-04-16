/**
 * Agent Server for Claude Agent SDK (TypeScript)
 *
 * Express server that hosts a Claude-powered agent backend.
 * The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
 */

import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { EventEncoder } from "@ag-ui/encoder";
import { EventType, RunAgentInput, Message } from "@ag-ui/core";
import * as dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
app.use(express.json());

const HOST = process.env.AGENT_HOST || "0.0.0.0";
const PORT = parseInt(process.env.AGENT_PORT || "8000", 10);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-20241022";

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

function buildAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({
        role: "user",
        content: (msg as any).content ?? "",
      });
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

// ---------------------------------------------------------------------------
// AG-UI streaming endpoint
// ---------------------------------------------------------------------------

app.post("/", async (req: Request, res: Response): Promise<void> => {
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
    // Run started
    emit({ type: EventType.RUN_STARTED, runId, threadId });

    const messages = buildAnthropicMessages(input.messages ?? []);
    const tools = buildTools(input.tools);

    // Build system prompt from context
    let systemPrompt =
      "You are a helpful AI assistant powered by Anthropic's Claude.";
    if (input.context && input.context.length > 0) {
      const contextStr = input.context
        .map((c: any) => `${c.description}: ${c.value}`)
        .join("\n");
      systemPrompt += `\n\nContext:\n${contextStr}`;
    }

    const claudeRequest: Anthropic.MessageCreateParamsStreaming = {
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
    };

    const stream = await anthropic.messages.stream(claudeRequest);

    let assistantMsgId: string | null = null;
    let toolCallId: string | null = null;
    let toolCallName: string | null = null;
    let toolCallArgs = "";
    let textMessageStarted = false;

    for await (const event of stream) {
      if (event.type === "message_start") {
        assistantMsgId = event.message.id;
        // Don't emit TEXT_MESSAGE_START here — wait until we actually
        // receive a text_delta so tool-call-only responses stay clean.
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
          // Lazily emit TEXT_MESSAGE_START on first text content
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
        // Only close the text message if we opened one
        if (textMessageStarted) {
          emit({
            type: EventType.TEXT_MESSAGE_END,
            messageId: msgId,
          });
        }
      }
    }

    // Design note: this is a pass-through architecture — all tools are
    // registered by the frontend via CopilotKit and forwarded here as
    // AG-UI tool definitions. When Claude responds with stop_reason
    // "tool_use", the tool calls have already been emitted above as
    // TOOL_CALL_START/ARGS/END events. The AG-UI client will execute
    // them on the frontend and re-invoke the agent with results. No
    // server-side tool execution loop is needed.

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
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    model: CLAUDE_MODEL,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
  });
});

app.listen(PORT, HOST, () => {
  console.log(`[agent_server] Listening on http://${HOST}:${PORT}`);
});
