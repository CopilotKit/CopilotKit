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

// @region[weather-tool-backend]
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
import {
  SET_NOTES_TOOL_SCHEMA,
  buildSharedStateReadWriteSystemPrompt,
  coercePreferences,
} from "./agent/shared-state-read-write-prompt";
import {
  SUBAGENT_SYSTEM_BY_NAME,
  SUBAGENT_TOOL_SCHEMAS,
  SUPERVISOR_SYSTEM_PROMPT,
  type SubAgentName,
} from "./agent/subagents-prompts";
import {
  A2UI_FIXED_SYSTEM_PROMPT,
  DISPLAY_FLIGHT_TOOL_SCHEMA,
  buildDisplayFlightOperations,
} from "./agent/a2ui-fixed-prompt";
import {
  HEADLESS_COMPLETE_SYSTEM_PROMPT,
  HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
  HEADLESS_GET_WEATHER_TOOL_SCHEMA,
  getStockPriceImpl,
  getWeatherImpl,
} from "./agent/headless-complete-prompt";

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
  const isPdf =
    mime === "application/pdf" || mime.toLowerCase().includes("pdf");

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
          } catch (parseErr) {
            // Surface the failure so we don't silently rewind tool args to
            // {}. For tools like `set_notes` that take an array, an empty
            // dict translates to an empty list and clears the user's notes.
            // Skip the tool_use block so we don't replay corrupted state.
            const message =
              parseErr instanceof Error ? parseErr.message : String(parseErr);
            console.warn(
              `[agent_server] failed to parse tool_use arguments for ${tc.function.name} (id=${tc.id}); skipping replay. error=${message}`,
            );
            continue;
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
      } catch (parseErr) {
        // Don't silently swap in an empty schema — Claude will then accept
        // any input shape, which compounds whatever caller bug produced
        // the malformed JSON. Warn loudly so the tool definition gets
        // fixed instead of being papered over.
        const message =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        console.warn(
          `[agent_server] failed to parse tool.parameters for ${tool.name}; using empty schema. error=${message}`,
        );
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
  /**
   * Enable Anthropic extended thinking and forward `thinking_delta` events
   * as AG-UI REASONING_MESSAGE_* events. Requires a model that supports
   * extended thinking (Claude 3.7 Sonnet / Claude 4 family). Sets
   * `thinking: { type: "enabled", budget_tokens }`.
   */
  enableThinking?: boolean;
  /** Override model used when `enableThinking` is set. */
  thinkingModel?: string;
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
      let model = useVision ? CLAUDE_VISION_MODEL : CLAUDE_MODEL;
      if (config.enableThinking && config.thinkingModel) {
        model = config.thinkingModel;
      }

      const claudeRequest: Anthropic.MessageCreateParamsStreaming = {
        model,
        max_tokens: config.enableThinking ? 8192 : 4096,
        system: systemPrompt,
        messages,
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
        ...(config.enableThinking
          ? {
              thinking: {
                type: "enabled" as const,
                budget_tokens: 2048,
              },
            }
          : {}),
      };

      let toolCallId: string | null = null;
      let toolCallName: string | null = null;
      let toolCallArgs = "";
      let textMessageStarted = false;
      let textMessageEnded = false;
      let reasoningMsgId: string | null = null;
      let reasoningStarted = false;
      let reasoningEnded = false;

      try {
        const stream = await anthropic.messages.stream(claudeRequest);

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
            } else if (
              (event.content_block as any).type === "thinking" &&
              config.enableThinking
            ) {
              reasoningMsgId = randomUUID();
              reasoningStarted = false;
              reasoningEnded = false;
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
            } else if (
              (event.delta as any).type === "thinking_delta" &&
              config.enableThinking &&
              reasoningMsgId
            ) {
              const thinkingText = (event.delta as any).thinking as string;
              if (!reasoningStarted) {
                emit({
                  type: EventType.REASONING_MESSAGE_START,
                  messageId: reasoningMsgId,
                  role: "assistant",
                });
                reasoningStarted = true;
              }
              emit({
                type: EventType.REASONING_MESSAGE_CONTENT,
                messageId: reasoningMsgId,
                delta: thinkingText,
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
            } else if (reasoningMsgId && reasoningStarted && !reasoningEnded) {
              emit({
                type: EventType.REASONING_MESSAGE_END,
                messageId: reasoningMsgId,
              });
              reasoningEnded = true;
              reasoningMsgId = null;
              reasoningStarted = false;
            }
          } else if (event.type === "message_stop") {
            if (textMessageStarted && !textMessageEnded) {
              emit({
                type: EventType.TEXT_MESSAGE_END,
                messageId: msgId,
              });
              textMessageEnded = true;
            }
          }
        }
      } finally {
        // Lifecycle guarantee: if we ever emitted TEXT_MESSAGE_START we MUST
        // emit a matching TEXT_MESSAGE_END, even when the stream throws
        // mid-token. Without this, AG-UI clients tracking message-id
        // lifecycle render a permanently in-flight assistant bubble.
        if (textMessageStarted && !textMessageEnded) {
          emit({
            type: EventType.TEXT_MESSAGE_END,
            messageId: msgId,
          });
          textMessageEnded = true;
        }
        if (reasoningMsgId && reasoningStarted && !reasoningEnded) {
          emit({
            type: EventType.REASONING_MESSAGE_END,
            messageId: reasoningMsgId,
          });
          reasoningEnded = true;
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
// State-aware demos (Shared State Read+Write, Sub-Agents)
// ---------------------------------------------------------------------------

// Sub-agent model is overridable so ops can swap a faster/cheaper model
// for the secondary calls without bumping the supervisor's model. See
// the showcase parity-notes for why we don't pin a single global model
// here.
//
// Precedence: `CLAUDE_SUBAGENT_MODEL` first to match the supervisor's
// `CLAUDE_MODEL` prefix (a deployment that sets `CLAUDE_*` everywhere
// shouldn't have to also set the legacy `ANTHROPIC_*` form). The
// `ANTHROPIC_SUBAGENT_MODEL` form is kept as a legacy fallback so we
// don't break existing deployments.
const SUBAGENT_MODEL =
  process.env.CLAUDE_SUBAGENT_MODEL ||
  process.env.ANTHROPIC_SUBAGENT_MODEL ||
  CLAUDE_MODEL;

interface Delegation {
  id: string;
  sub_agent: SubAgentName;
  task: string;
  status: "running" | "completed" | "failed";
  result: string;
}

/**
 * Run a single Anthropic Messages API call for a sub-agent. No tools,
 * no streaming — we just want the final text back so the supervisor can
 * read it on its next step. Mirrors `_invoke_sub_agent` in
 * `google-adk/src/agents/subagents_agent.py`.
 */
async function invokeSubAgent(
  systemPrompt: string,
  task: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: SUBAGENT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: task }],
  });
  const parts = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text);
  const text = parts.join("").trim();
  if (!text) {
    throw new Error("sub-agent returned empty text");
  }
  return text;
}

interface ExecuteToolResult {
  resultText: string;
  state: Record<string, unknown> | null;
}

/**
 * Execute a backend-implemented tool. Returns the JSON-encoded result
 * the supervisor will receive AND the new state snapshot to emit to
 * the UI (or `null` if state is unchanged).
 *
 * For sub-agent delegations we update `state.delegations` twice:
 *   - once with `status: "running"` BEFORE the secondary Anthropic call
 *   - once with `status: "completed"` (or `"failed"`) AFTER it returns
 *
 * The first STATE_SNAPSHOT is emitted by the caller via `onRunningEntry`;
 * we return the final state from this function.
 */
async function executeBackendTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  state: Record<string, unknown>,
  emit: (event: object) => void,
): Promise<ExecuteToolResult> {
  if (toolName === "display_flight") {
    const origin = typeof toolInput.origin === "string" ? toolInput.origin : "";
    const destination =
      typeof toolInput.destination === "string" ? toolInput.destination : "";
    const airline =
      typeof toolInput.airline === "string" ? toolInput.airline : "";
    const price = typeof toolInput.price === "string" ? toolInput.price : "";
    const ops = buildDisplayFlightOperations({
      origin,
      destination,
      airline,
      price,
    });
    return {
      resultText: JSON.stringify(ops),
      state: null,
    };
  }

  if (toolName === "get_weather") {
    const location =
      typeof toolInput.location === "string" ? toolInput.location : "";
    return {
      resultText: JSON.stringify(getWeatherImpl(location)),
      state: null,
    };
  }
  // @endregion[weather-tool-backend]

  if (toolName === "get_stock_price") {
    const ticker = typeof toolInput.ticker === "string" ? toolInput.ticker : "";
    return {
      resultText: JSON.stringify(getStockPriceImpl(ticker)),
      state: null,
    };
  }

  if (toolName === "set_notes") {
    const notes = Array.isArray(toolInput.notes)
      ? (toolInput.notes as unknown[]).filter(
          (n): n is string => typeof n === "string",
        )
      : [];
    const next = { ...state, notes };
    return {
      resultText: JSON.stringify({ status: "ok", count: notes.length }),
      state: next,
    };
  }

  if (
    toolName === "research_agent" ||
    toolName === "writing_agent" ||
    toolName === "critique_agent"
  ) {
    const subAgentName = toolName as SubAgentName;
    const task = typeof toolInput.task === "string" ? toolInput.task : "";
    const id = randomUUID();
    const existing = Array.isArray(state.delegations)
      ? (state.delegations as Delegation[])
      : [];
    const runningEntry: Delegation = {
      id,
      sub_agent: subAgentName,
      task,
      status: "running",
      result: "",
    };
    const stateWithRunning = {
      ...state,
      delegations: [...existing, runningEntry],
    };
    // Emit the in-flight state so the UI's delegation log shows a
    // "running" row immediately, before we await the secondary call.
    emit({ type: EventType.STATE_SNAPSHOT, snapshot: stateWithRunning });

    try {
      const result = await invokeSubAgent(
        SUBAGENT_SYSTEM_BY_NAME[subAgentName],
        task,
      );
      const finalEntry: Delegation = {
        ...runningEntry,
        status: "completed",
        result,
      };
      const nextState = {
        ...state,
        delegations: [...existing, finalEntry],
      };
      return {
        resultText: JSON.stringify({ status: "completed", result }),
        state: nextState,
      };
    } catch (err) {
      const errorClass =
        err instanceof Error ? err.constructor.name : typeof err;
      const fullMessage = err instanceof Error ? err.message : String(err);
      // Scrub raw error.message from anything that crosses the wire to the
      // UI or back to the supervisor LLM. Anthropic SDK errors can contain
      // request ids, partial prompt text, and rate-limit detail an end user
      // shouldn't see (and that the supervisor doesn't need either —
      // matching the cohort, we surface only the error class). Full
      // message + stack still go to server logs below for ops.
      const scrubbed = `sub-agent call failed: ${errorClass} (see server logs)`;
      const failedEntry: Delegation = {
        ...runningEntry,
        status: "failed",
        result: scrubbed,
      };
      const nextState = {
        ...state,
        delegations: [...existing, failedEntry],
      };
      console.error(
        `[agent_server] sub-agent ${subAgentName} failed: ${errorClass}: ${fullMessage}`,
        err instanceof Error && err.stack ? err.stack : undefined,
      );
      return {
        resultText: JSON.stringify({ status: "failed", error: scrubbed }),
        state: nextState,
      };
    }
  }

  return {
    resultText: JSON.stringify({ status: "error", error: "unknown_tool" }),
    state: null,
  };
}

interface AgenticLoopConfig {
  systemPrompt: string;
  toolSchemas: Anthropic.Tool[];
  initialState: Record<string, unknown>;
}

/**
 * Run a full agentic loop: stream Claude, execute backend tools when
 * the model emits tool_use blocks, push tool_result back into the
 * conversation, and continue until Claude stops calling tools.
 *
 * Used by the Shared State (Read + Write) and Sub-Agents demos, which
 * own their tools server-side. The default pass-through handler stays
 * unchanged — frontend-registered tools never reach this path.
 */
async function runAgenticLoop(
  req: Request,
  res: Response,
  config: AgenticLoopConfig,
): Promise<void> {
  const input = req.body as RunAgentInput;
  const accept = req.headers["accept"] ?? "";

  const encoder = new EventEncoder({ accept });
  res.setHeader("Content-Type", encoder.getContentType());
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const runId = input.runId ?? randomUUID();
  const threadId = input.threadId ?? randomUUID();

  const emit = (event: object) => {
    res.write(encoder.encodeSSE(event as any));
  };

  let state = { ...config.initialState };

  try {
    emit({ type: EventType.RUN_STARTED, runId, threadId });

    const messages = buildAnthropicMessages(input.messages ?? []);
    // Merge runtime tools (frontend-registered via useFrontendTool /
    // useRenderTool) with the demo's backend tools. The supervisor / RW
    // agent therefore still works alongside any frontend tool the demo
    // page chooses to register.
    const runtimeTools = buildTools(input.tools);
    const tools: Anthropic.Tool[] = [...config.toolSchemas, ...runtimeTools];
    const backendToolNames = new Set(config.toolSchemas.map((t) => t.name));

    // Maximum tool iterations per run. The supervisor demo can fan out
    // to research -> write -> critique, but we cap turns to prevent a
    // misbehaving model from running unbounded.
    const MAX_TOOL_ITERATIONS = 10;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const msgId = randomUUID();
      let textMessageStarted = false;
      const pendingToolCalls: Array<{
        id: string;
        name: string;
        argsJson: string;
      }> = [];
      let activeToolCallId: string | null = null;
      let activeToolCallName: string | null = null;
      let activeToolArgs = "";
      let assistantText = "";

      let textMessageEnded = false;
      try {
        const stream = await anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: config.systemPrompt,
          messages,
          stream: true,
          ...(tools.length > 0 ? { tools } : {}),
        });

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              activeToolCallId = event.content_block.id;
              activeToolCallName = event.content_block.name;
              activeToolArgs = "";
              emit({
                type: EventType.TOOL_CALL_START,
                toolCallId: activeToolCallId,
                toolCallName: activeToolCallName,
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
              assistantText += event.delta.text;
              emit({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: msgId,
                delta: event.delta.text,
              });
            } else if (event.delta.type === "input_json_delta") {
              if (activeToolCallId) {
                activeToolArgs += event.delta.partial_json;
                emit({
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: activeToolCallId,
                  delta: event.delta.partial_json,
                });
              }
            }
          } else if (event.type === "content_block_stop") {
            if (activeToolCallId && activeToolCallName) {
              emit({
                type: EventType.TOOL_CALL_END,
                toolCallId: activeToolCallId,
              });
              pendingToolCalls.push({
                id: activeToolCallId,
                name: activeToolCallName,
                argsJson: activeToolArgs,
              });
              activeToolCallId = null;
              activeToolCallName = null;
              activeToolArgs = "";
            }
          }
        }

        if (textMessageStarted && !textMessageEnded) {
          emit({
            type: EventType.TEXT_MESSAGE_END,
            messageId: msgId,
          });
          textMessageEnded = true;
        }
      } finally {
        // Lifecycle guarantee: every TEXT_MESSAGE_START must be paired with
        // a TEXT_MESSAGE_END, even if anthropic.messages.stream throws
        // mid-token. Without this, the AG-UI client renders a permanently
        // in-flight assistant bubble. The outer try/catch still emits
        // RUN_ERROR for the caller to surface the failure.
        if (textMessageStarted && !textMessageEnded) {
          emit({
            type: EventType.TEXT_MESSAGE_END,
            messageId: msgId,
          });
          textMessageEnded = true;
        }
      }

      // No tool calls — we're done.
      if (pendingToolCalls.length === 0) {
        break;
      }

      // Append the assistant turn (text + tool_use blocks) to the
      // conversation so the next call sees the supervisor's plan.
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (assistantText) {
        assistantContent.push({ type: "text", text: assistantText });
      }
      for (const tc of pendingToolCalls) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = tc.argsJson ? JSON.parse(tc.argsJson) : {};
        } catch (parseErr) {
          // The streamed input_json_delta concatenated into invalid JSON.
          // Logging is essential — without it, the next iteration sees
          // empty args and the model is told its tool call succeeded with
          // no parameters, which is silently wrong. We still replay the
          // tool_use (Anthropic requires every tool_use to be followed by
          // a tool_result of the same id), but with empty input. The
          // matching execute branch below also skips with a clear error.
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.warn(
            `[agent_server] failed to parse streamed tool args for ${tc.name} (id=${tc.id}); replaying with empty input. error=${message}`,
          );
        }
        assistantContent.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: parsed,
        });
      }
      messages.push({ role: "assistant", content: assistantContent });

      // Execute backend tools and push their tool_result blocks. Frontend
      // tools (anything not in `backendToolNames`) are NOT executed here
      // — they're meant to be handled by the AG-UI client. In practice
      // these two demos don't expose any extra frontend tools, but we
      // keep the merging behaviour defensive so a future demo page can
      // add `useFrontendTool` without breaking things.
      const toolResults: Anthropic.ContentBlockParam[] = [];
      let sawFrontendTool = false;
      for (const tc of pendingToolCalls) {
        if (!backendToolNames.has(tc.name)) {
          sawFrontendTool = true;
          continue;
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = tc.argsJson ? JSON.parse(tc.argsJson) : {};
        } catch (parseErr) {
          // CRITICAL: do NOT fall through to `{}` here. For tools like
          // `set_notes` that take an array of notes, an empty dict is
          // coerced to an empty list and silently clears the user's
          // notes. Surface a tool_result with an explicit error so the
          // model sees its call failed and the supervisor can retry,
          // rather than seeing a "successful" no-op.
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.warn(
            `[agent_server] failed to parse streamed tool args for backend tool ${tc.name} (id=${tc.id}); skipping execution. error=${message}`,
          );
          const errorResult = JSON.stringify({
            status: "error",
            error: "invalid_tool_arguments",
            detail:
              "Tool arguments failed to parse as JSON; tool was not executed. " +
              "Re-issue the call with valid JSON.",
          });
          emit({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: tc.id,
            content: errorResult,
            messageId: randomUUID(),
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: errorResult,
          });
          continue;
        }
        const exec = await executeBackendTool(tc.name, parsed, state, emit);
        if (exec.state) {
          state = exec.state;
          emit({ type: EventType.STATE_SNAPSHOT, snapshot: state });
        }
        emit({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId: tc.id,
          content: exec.resultText,
          messageId: randomUUID(),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: exec.resultText,
        });
      }

      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
      }

      // If Claude called a frontend tool, stop the loop and let the
      // AG-UI client handle execution + re-invocation.
      if (sawFrontendTool) {
        break;
      }
    }

    emit({ type: EventType.RUN_FINISHED, runId, threadId });
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[agent_server] ERROR (agentic loop): ${err.message}`);
    emit({
      type: EventType.RUN_ERROR,
      runId,
      threadId,
      message: err.message,
      code: "AGENT_ERROR",
    });
  }

  res.end();
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

// Reasoning demos — enable Anthropic extended-thinking and forward
// `thinking_delta` events as AG-UI REASONING_MESSAGE_* events. The
// claude-3-7-sonnet family supports extended thinking.
const CLAUDE_REASONING_MODEL =
  process.env.CLAUDE_REASONING_MODEL || "claude-3-7-sonnet-20250219";
const REASONING_SYSTEM_PROMPT =
  "You are a helpful assistant. For each user question, first think " +
  "step-by-step about the approach, then give a concise answer.";

app.post(
  "/reasoning",
  makeAgentHandler({
    systemPrompt: REASONING_SYSTEM_PROMPT,
    enableThinking: true,
    thinkingModel: CLAUDE_REASONING_MODEL,
  }),
);

// Shared State (Read + Write) — UI writes preferences via agent.setState,
// the agent reads them out of input.state every turn and prepends them to
// the system prompt; the backend `set_notes` tool writes notes back into
// shared state, emitted via STATE_SNAPSHOT.
app.post(
  "/shared-state-read-write",
  async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RunAgentInput;
    const incomingState =
      ((input as any).state as Record<string, unknown> | undefined) ?? {};
    const prefs = coercePreferences(incomingState.preferences);
    const notes = Array.isArray(incomingState.notes)
      ? (incomingState.notes as unknown[]).filter(
          (n): n is string => typeof n === "string",
        )
      : [];
    await runAgenticLoop(req, res, {
      systemPrompt: buildSharedStateReadWriteSystemPrompt(prefs),
      toolSchemas: [SET_NOTES_TOOL_SCHEMA] as Anthropic.Tool[],
      initialState: { preferences: prefs, notes },
    });
  },
);

// Sub-Agents — supervisor with three sub-agent-as-tool delegations,
// each a single secondary Anthropic Messages call. Every delegation is
// recorded in state.delegations (running -> completed/failed) and
// streamed to the UI via STATE_SNAPSHOT.
app.post("/subagents", async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RunAgentInput;
  const incomingState =
    ((input as any).state as Record<string, unknown> | undefined) ?? {};
  const delegations = Array.isArray(incomingState.delegations)
    ? incomingState.delegations
    : [];
  await runAgenticLoop(req, res, {
    systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
    toolSchemas: SUBAGENT_TOOL_SCHEMAS as Anthropic.Tool[],
    initialState: { delegations },
  });
});

// A2UI Fixed Schema — backend ships flight_schema.json and exposes a
// single `display_flight` tool that emits an `a2ui_operations` container.
// The dedicated runtime route at `/api/copilotkit-a2ui-fixed-schema` runs
// the A2UI middleware with `injectA2UITool: false` because this backend
// owns the rendering tool itself.
app.post(
  "/a2ui-fixed-schema",
  async (req: Request, res: Response): Promise<void> => {
    await runAgenticLoop(req, res, {
      systemPrompt: A2UI_FIXED_SYSTEM_PROMPT,
      toolSchemas: [DISPLAY_FLIGHT_TOOL_SCHEMA] as Anthropic.Tool[],
      initialState: {},
    });
  },
);

// Headless Chat (Complete) — backend exposes get_weather + get_stock_price
// tools the frontend renders via per-tool useRenderTool renderers, plus
// participates in the frontend `highlight_note` tool flow (forwarded as
// a passthrough).
app.post(
  "/headless-complete",
  async (req: Request, res: Response): Promise<void> => {
    await runAgenticLoop(req, res, {
      systemPrompt: HEADLESS_COMPLETE_SYSTEM_PROMPT,
      toolSchemas: [
        HEADLESS_GET_WEATHER_TOOL_SCHEMA,
        HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
      ] as Anthropic.Tool[],
      initialState: {},
    });
  },
);

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
