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

import type { Request, Response } from "express";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { EventEncoder } from "@ag-ui/encoder";
import type { RunAgentInput, Message } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import {
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
} from "@copilotkit/shared";
import * as dotenv from "dotenv";
import * as PartialJSON from "partial-json";
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
} from "./agent/subagents-prompts";
import type { SubAgentName } from "./agent/subagents-prompts";
import {
  A2UI_FIXED_SYSTEM_PROMPT,
  DISPLAY_FLIGHT_TOOL_SCHEMA,
  buildDisplayFlightOperations,
} from "./agent/a2ui-fixed-prompt";
import {
  A2UI_DYNAMIC_SYSTEM_PROMPT,
  GENERATE_A2UI_TOOL_SCHEMA,
} from "./agent/a2ui-dynamic-prompt";
import {
  HEADLESS_COMPLETE_SYSTEM_PROMPT,
  HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
  HEADLESS_GET_WEATHER_TOOL_SCHEMA,
  getStockPriceImpl,
  getWeatherImpl,
} from "./agent/headless-complete-prompt";
import {
  GEN_UI_AGENT_SYSTEM_PROMPT,
  SET_STEPS_TOOL_SCHEMA,
} from "./agent/gen-ui-agent-prompt";
import {
  REASONING_CHAIN_SYSTEM_PROMPT,
  ROLL_D20_TOOL_SCHEMA,
  ROLL_DICE_TOOL_SCHEMA,
  SEARCH_FLIGHTS_TOOL_SCHEMA,
  TOOL_RENDERING_SYSTEM_PROMPT,
  rollD20Impl,
  rollDiceImpl,
  searchFlightsImpl as searchFlightsByRouteImpl,
} from "./agent/tool-rendering-prompts";
import {
  runWithClaudeAgentSdk,
  shouldUseClaudeAgentSdk,
} from "./claude-agent-sdk-adapter";
import { queryDataImpl, renderFlightsImpl } from "./agent/beautiful-chat-tools";
import type { Flight } from "./agent/beautiful-chat-tools";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
// Increase payload limit so base64-encoded attachments (images, PDFs) up
// to the frontend's 10MB cap fit inside the request body.
app.use(express.json({ limit: "20mb" }));

const HOST = process.env.AGENT_HOST || "0.0.0.0";
const PORT = parseInt(process.env.AGENT_PORT || "8000", 10);
const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4.6";
const CLAUDE_VISION_MODEL =
  process.env.CLAUDE_VISION_MODEL ||
  process.env.ANTHROPIC_VISION_MODEL ||
  CLAUDE_MODEL;

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
 * Extract inbound headers that should ride along to the outbound Anthropic
 * call: `authorization` + every `x-*` header. Mirrors the runtime's
 * `extractForwardableHeaders` (@copilotkit/runtime
 * `v2/runtime/handlers/header-utils.ts`) and the LGT/LGP forwarding
 * pattern. Notably, `x-aimock-context` rides via this path so aimock can
 * match the right fixture; without this, every outbound `/v1/messages`
 * request loses the discriminator and aimock returns 404.
 *
 * Returns a plain Record so it can be spread into Anthropic SDK
 * `RequestOptions.headers` on every `messages.stream` / `messages.create`
 * call. We strip `host`, `content-length` and `accept-encoding` because
 * those are connection-level concerns the SDK manages itself.
 */
function extractForwardedHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value !== "string") continue;
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower.startsWith("x-")) {
      out[key] = value;
    }
  }
  // CVDIAG (als-snapshot): record whether the inbound x-aimock-context
  // discriminator was present at the moment we capture the inbound
  // headers off the Express request. Never log the full value — prefix
  // only. Header lookups are case-insensitive against the captured map.
  const lookup = (name: string): string | undefined => {
    for (const [k, v] of Object.entries(out)) {
      if (k.toLowerCase() === name) return v;
    }
    return undefined;
  };
  const slug = lookup("x-aimock-context");
  const runId = lookup("x-diag-run-id");
  const hops = lookup("x-diag-hops");
  const hopCount = hops ? hops.split(",").filter(Boolean).length : 0;
  console.log(
    `CVDIAG component=route-claude-sdk-ts boundary=als-snapshot ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hops ? hopCount : "-"} status=${slug ? "ok" : "miss"} ` +
      `test_id=${lookup("x-test-id") ?? "none"} error=`,
  );
  return out;
}

/**
 * CVDIAG (outbound-llm) choke-point for the claude-sdk-ts backend. Returns
 * a NEW headers map (never mutates the caller's) with this layer's hop tag
 * appended to the x-diag-hops breadcrumb, and logs header presence at the
 * moment the outbound Anthropic request is built. x-diag-run-id /
 * x-diag-hops ride the same x-* forwarding path as x-aimock-context (both
 * captured by `extractForwardedHeaders`); we only append the breadcrumb hop
 * here. Returns the augmented map so callers spread it into the SDK
 * `RequestOptions.headers`.
 */
function diagOutboundHeaders(
  forwardedHeaders: Record<string, string>,
): Record<string, string> {
  const lookup = (name: string): string | undefined => {
    for (const [k, v] of Object.entries(forwardedHeaders)) {
      if (k.toLowerCase() === name) return v;
    }
    return undefined;
  };
  const slug = lookup("x-aimock-context");
  const runId = lookup("x-diag-run-id");
  // GATING RULE: only deviate from the original control flow (append the
  // x-diag-hops breadcrumb, emit the per-outbound CVDIAG log) when a
  // diagnostic header is present (x-diag-run-id OR x-aimock-context). On
  // non-diagnostic traffic return the forwarded headers UNCHANGED so the
  // outbound Anthropic request is byte-identical to pre-instrumentation, and
  // skip the noisy per-outbound log.
  const diagnosticPresent = runId != null || slug != null;
  if (!diagnosticPresent) {
    return forwardedHeaders;
  }
  const priorHops = lookup("x-diag-hops") ?? "";
  const nextHops = priorHops
    ? `${priorHops},backend-claude-sdk-ts`
    : "backend-claude-sdk-ts";
  // Build a fresh map so we don't mutate the shared forwardedHeaders that
  // may be reused across multiple outbound calls in the agentic loop.
  const augmented: Record<string, string> = {
    ...forwardedHeaders,
    "x-diag-hops": nextHops,
  };
  const hopCount = nextHops.split(",").filter(Boolean).length;
  console.log(
    `CVDIAG component=backend-claude-sdk-ts boundary=outbound-llm ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hopCount} status=${slug ? "ok" : "miss"} ` +
      `test_id=${lookup("x-test-id") ?? "none"} error=`,
  );
  return augmented;
}

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

function latestUserMessageOnly(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      return [messages[index]!];
    }
  }
  return [];
}

function buildAgentContextString(context: unknown): string {
  if (!Array.isArray(context) || context.length === 0) return "";

  return context
    .map((entry): string => {
      if (!entry || typeof entry !== "object") return "";
      const record = entry as Record<string, unknown>;
      const description =
        typeof record.description === "string" ? record.description : "";
      const value =
        typeof record.value === "string"
          ? record.value
          : record.value == null
            ? ""
            : JSON.stringify(record.value);
      if (!description && !value) return "";
      return description ? `${description}: ${value}` : value;
    })
    .filter(Boolean)
    .join("\n");
}

function appendContextToSystemPrompt(
  systemPrompt: string,
  contextString: string,
): string {
  if (!contextString) return systemPrompt;
  return `${systemPrompt}\n\nContext:\n${contextString}`;
}

// @region[frontend-tools-setup]
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
// @endregion[frontend-tools-setup]

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

const BEAUTIFUL_CHAT_SYSTEM_PROMPT =
  "You are a helpful CopilotKit demo assistant. Use the available tools " +
  "to render rich UI instead of describing UI in prose.\n\n" +
  "Routing rules:\n" +
  "- Charts: call `query_data` first when the user asks for financial data, " +
  "then use the frontend chart tool requested by the user.\n" +
  "- Flights: call `search_flights` with exactly two complete flight objects " +
  "so the A2UI flight cards can render.\n" +
  "- Dashboards: call `query_data`, then `generate_a2ui`.\n" +
  "- Todos: call `enableAppMode` first, then `manage_todos` with the full " +
  "todo list.\n" +
  "- Meetings and theme changes are frontend tools; call the matching " +
  "frontend tool when requested.\n\n" +
  "After tools complete, summarize the result in one short sentence.";

const QUERY_DATA_TOOL_SCHEMA: Anthropic.Tool = {
  name: "query_data",
  description:
    "Query the financial database for chart and dashboard data. Always call " +
    "before showing financial charts or dashboards.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language query for financial data.",
      },
    },
    required: ["query"],
  },
};

const MANAGE_TODOS_TOOL_SCHEMA: Anthropic.Tool = {
  name: "manage_todos",
  description:
    "Replace the beautiful-chat task manager todo list. Always include every " +
    "todo that should remain visible.",
  input_schema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The complete task-manager todo list.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            emoji: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "completed"],
            },
          },
          required: ["title", "description", "emoji", "status"],
        },
      },
    },
    required: ["todos"],
  },
};

const GET_TODOS_TOOL_SCHEMA: Anthropic.Tool = {
  name: "get_todos",
  description: "Get the current beautiful-chat task manager todo list.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const BEAUTIFUL_CHAT_SEARCH_FLIGHTS_TOOL_SCHEMA: Anthropic.Tool = {
  name: "search_flights",
  description:
    "Render A2UI flight cards. Provide exactly two complete flights with " +
    "airline, logo, flight number, route, date, times, duration, status, " +
    "price, and currency.",
  input_schema: {
    type: "object",
    properties: {
      flights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            airline: { type: "string" },
            airlineLogo: { type: "string" },
            flightNumber: { type: "string" },
            origin: { type: "string" },
            destination: { type: "string" },
            date: { type: "string" },
            departureTime: { type: "string" },
            arrivalTime: { type: "string" },
            duration: { type: "string" },
            status: { type: "string" },
            statusColor: { type: "string" },
            price: { type: "string" },
            currency: { type: "string" },
          },
          required: [
            "airline",
            "airlineLogo",
            "flightNumber",
            "origin",
            "destination",
            "date",
            "departureTime",
            "arrivalTime",
            "duration",
            "status",
            "statusColor",
            "price",
            "currency",
          ],
        },
      },
    },
    required: ["flights"],
  },
};

const DECLARATIVE_GEN_UI_CATALOG_ID = "declarative-gen-ui-catalog";

const DECLARATIVE_GEN_UI_CATALOG_GUIDE = `\
Registered catalog fallback:
- ${DECLARATIVE_GEN_UI_CATALOG_ID}
  Extends the basic A2UI catalog. Custom components:
  - Card: { title: string, subtitle?: string, child?: string }
  - StatusBadge: { text: string, variant?: "success" | "warning" | "error" | "info" }
  - Metric: { label: string, value: string, trend?: "up" | "down" | "neutral" }
  - InfoRow: { label: string, value: string }
  - PrimaryButton: { label: string, action?: object }
  - PieChart: { title: string, description: string, data: Array<{ label: string, value: number }> }
  - BarChart: { title: string, description: string, data: Array<{ label: string, value: number }> }
Use Column or Row from the basic catalog to group multiple Metrics or badges.`;

const DECLARATIVE_GEN_UI_SECONDARY_PROMPT = `\
You are an A2UI v0.9 component designer for the Declarative Generative UI demo.
Call render_a2ui exactly once. Emit only valid tool arguments.
Use catalogId "${DECLARATIVE_GEN_UI_CATALOG_ID}".
Every component must include a unique "id" and a "component" name.
Exactly one component must have id "root"; the renderer starts there.
Props go beside "id" and "component" on each flat component object.
For static composition, use "child": "component-id" or
"children": ["component-id", ...].`;

const RENDER_A2UI_TOOL_SCHEMA: Anthropic.Tool = {
  name: "render_a2ui",
  description: "Render a dynamic A2UI v0.9 surface.",
  input_schema: {
    type: "object",
    properties: {
      surfaceId: {
        type: "string",
        description: "Unique surface identifier.",
      },
      catalogId: {
        type: "string",
        description:
          "The catalog ID. This demo registers declarative-gen-ui-catalog.",
      },
      components: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            component: { type: "string" },
          },
          required: ["id", "component"],
          additionalProperties: true,
        },
        description:
          "A2UI component array in flat { id, component, ...props } format. " +
          "Exactly one component must have id 'root'.",
      },
      data: {
        type: "object",
        description: "Optional initial data model for the surface.",
      },
    },
    required: ["surfaceId", "catalogId", "components"],
  },
};

function maybeParseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function sanitizeA2uiComponent(
  component: unknown,
): Record<string, unknown> | null {
  if (!component || typeof component !== "object") return null;
  const record = component as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const componentName =
    typeof record.component === "string"
      ? record.component
      : typeof record.type === "string"
        ? record.type
        : "";
  if (!id || !componentName) return null;

  const sanitized: Record<string, unknown> = {
    ...record,
    id,
    component: componentName,
  };
  delete sanitized.type;

  for (const field of ["data", "value", "children"] as const) {
    sanitized[field] = maybeParseJsonField(sanitized[field]);
  }

  return sanitized;
}

function collectChildRefs(component: Record<string, unknown>): Set<string> {
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      refs.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") refs.add(record.id);
    if (typeof record.componentId === "string") refs.add(record.componentId);
  };

  visit(component.child);
  visit(component.children);
  return refs;
}

function replaceChildRef(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) {
    return value.map((item) => replaceChildRef(item, from, to));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const next = { ...record };
  if (next.id === from) next.id = to;
  if (next.componentId === from) next.componentId = to;
  return next;
}

function normalizeA2uiComponents(
  rawComponents: unknown,
): Record<string, unknown>[] {
  const sanitized = Array.isArray(rawComponents)
    ? rawComponents
        .map(sanitizeA2uiComponent)
        .filter(
          (component): component is Record<string, unknown> =>
            component !== null,
        )
    : [];

  const uniqueComponents: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  for (const component of sanitized) {
    const id = component.id as string;
    if (seenIds.has(id)) {
      console.warn(`[agent_server] dropping duplicate A2UI component id=${id}`);
      continue;
    }
    seenIds.add(id);
    uniqueComponents.push(component);
  }

  const rootIndex = uniqueComponents.findIndex(
    (component) => component.id === "root",
  );
  if (rootIndex >= 0) return uniqueComponents;
  if (uniqueComponents.length === 0) return [];

  const referencedIds = new Set<string>();
  for (const component of uniqueComponents) {
    for (const ref of collectChildRefs(component)) {
      referencedIds.add(ref);
    }
  }

  const topLevelComponents = uniqueComponents.filter(
    (component) => !referencedIds.has(component.id as string),
  );

  if (topLevelComponents.length === 1) {
    const rootCandidate = topLevelComponents[0]!;
    const priorId = rootCandidate.id as string;
    console.warn(`[agent_server] normalizing A2UI root id ${priorId} -> root`);
    return uniqueComponents.map((component) => ({
      ...component,
      id: component.id === priorId ? "root" : component.id,
      child: replaceChildRef(component.child, priorId, "root"),
      children: replaceChildRef(component.children, priorId, "root"),
    }));
  }

  console.warn(
    "[agent_server] inserting A2UI root Column for generated components",
  );
  return [
    {
      id: "root",
      component: "Column",
      children: topLevelComponents.length
        ? topLevelComponents.map((component) => component.id)
        : uniqueComponents.map((component) => component.id),
    },
    ...uniqueComponents,
  ];
}

function buildDeclarativeA2uiSystemPrompt(agentContext: string): string {
  return [
    DECLARATIVE_GEN_UI_SECONDARY_PROMPT,
    A2UI_DEFAULT_GENERATION_GUIDELINES,
    A2UI_DEFAULT_DESIGN_GUIDELINES,
    "Registered catalog/context:",
    agentContext || DECLARATIVE_GEN_UI_CATALOG_GUIDE,
  ].join("\n\n");
}

function buildA2uiOperationsFromRenderArgs(args: Record<string, unknown>) {
  const surfaceId =
    typeof args.surfaceId === "string" && args.surfaceId
      ? args.surfaceId
      : "dynamic-surface";
  // The page registers exactly one catalog. LangGraph gets the same
  // guarantee from the A2UI runtime's defaultCatalogId; this backend builds
  // A2UI operations itself, so normalize the model output here instead of
  // trusting a generated catalogId such as "default".
  const catalogId = DECLARATIVE_GEN_UI_CATALOG_ID;
  const components = normalizeA2uiComponents(args.components);
  const data =
    args.data && typeof args.data === "object"
      ? (args.data as Record<string, unknown>)
      : undefined;

  // A2UI middleware expects the v0.9 nested operation shape. The legacy
  // flat `{ type: "create_surface" }` form looks reasonable but is not
  // recognized by `@ag-ui/a2ui-middleware`, so the renderer never sees
  // the surface schema.
  const a2ui_operations: Array<Record<string, unknown>> = [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId },
    },
    {
      version: "v0.9",
      updateComponents: { surfaceId, components },
    },
  ];
  if (data) {
    a2ui_operations.push({
      version: "v0.9",
      updateDataModel: {
        surfaceId,
        path: "/",
        value: data,
      },
    });
  }
  return { a2ui_operations };
}

// @region[a2ui-backend-tool]
async function generateDeclarativeA2uiOperations(
  context: string,
  forwardedHeaders: Record<string, string>,
  agentContext: string = "",
): Promise<string> {
  const prompt = context || "Generate a useful dashboard UI.";
  const response = await anthropic.messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: buildDeclarativeA2uiSystemPrompt(agentContext),
      messages: [{ role: "user", content: prompt }],
      tools: [RENDER_A2UI_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "render_a2ui" },
    },
    { headers: diagOutboundHeaders(forwardedHeaders) },
  );

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "render_a2ui") {
      return JSON.stringify(
        buildA2uiOperationsFromRenderArgs(
          (block.input ?? {}) as Record<string, unknown>,
        ),
      );
    }
  }

  return JSON.stringify({ error: "secondary Claude call did not render A2UI" });
}
// @endregion[a2ui-backend-tool]

// ---------------------------------------------------------------------------
// AG-UI streaming endpoint factory
// ---------------------------------------------------------------------------

function makeAgentHandler(config: DemoConfig = {}) {
  return async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RunAgentInput;
    const accept = req.headers["accept"] ?? "";
    // Inbound x-* / authorization headers travel from the AG-UI client →
    // CopilotRuntime → HttpAgent → here. We forward them to every
    // Anthropic call so aimock (and any other downstream observer)
    // receives `x-aimock-context` and friends.
    const forwardedHeaders = extractForwardedHeaders(req);

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

      // @region[agent-context-setup]
      if (input.context && input.context.length > 0) {
        const contextStr = input.context
          .map((c: any) => `${c.description}: ${c.value}`)
          .join("\n");
        systemPrompt += `\n\nContext:\n${contextStr}`;
      }
      // @endregion[agent-context-setup]

      const useVision =
        config.forceVisionModel || messagesHaveAttachments(userMessages);
      let model = useVision ? CLAUDE_VISION_MODEL : CLAUDE_MODEL;
      if (config.enableThinking && config.thinkingModel) {
        model = config.thinkingModel;
      }

      if (
        shouldUseClaudeAgentSdk({
          input,
          forwardedHeaders,
          runtimeToolCount: tools.length,
          enableThinking: config.enableThinking,
        })
      ) {
        await runWithClaudeAgentSdk({
          input,
          emit,
          runId,
          threadId,
          systemPrompt,
          toolSchemas: [],
          initialState: {},
          model,
          forwardedHeaders,
          executeTool: async () => ({
            resultText: JSON.stringify({
              status: "error",
              error: "unknown_tool",
            }),
            state: null,
          }),
        });
        res.end();
        return;
      }

      emit({ type: EventType.RUN_STARTED, runId, threadId });

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
      // Per-content-block text lifecycle (R3-A9): a single Claude turn can
      // emit multiple text blocks interleaved with tool_use / thinking.
      // Each text block owns its own AG-UI TEXT_MESSAGE_* triplet, opened
      // at content_block_start (text) and closed at content_block_stop —
      // never deferred to message_stop / finally, which would interleave
      // TOOL_CALL_START inside an open text bubble for text→tool_use
      // sequences. `textMessageStarted` here tracks whether the CURRENT
      // active block has emitted START yet (text_delta is the first
      // signal a non-empty block exists); reset per block.
      let activeTextBlockId: string | null = null;
      let textMessageStarted = false;
      let reasoningMsgId: string | null = null;
      let reasoningStarted = false;
      let reasoningEnded = false;

      try {
        const stream = await anthropic.messages.stream(claudeRequest, {
          headers: diagOutboundHeaders(forwardedHeaders),
        });

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
            } else if ((event.content_block as any).type === "text") {
              // Open a fresh text block. The first delta opens the
              // TEXT_MESSAGE_START; content_block_stop closes it. Each
              // text content_block gets its own messageId so multi-text
              // turns (e.g. text→tool_use→text) emit distinct AG-UI
              // lifecycles instead of reusing the outer turn-scoped msgId
              // (mirrors runAgenticLoop's per-block randomUUID, R5-A1).
              activeTextBlockId = randomUUID();
              textMessageStarted = false;
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
                  messageId: activeTextBlockId ?? msgId,
                  role: "assistant",
                });
                textMessageStarted = true;
              }
              emit({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: activeTextBlockId ?? msgId,
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
                  role: "reasoning",
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
            } else if (activeTextBlockId && textMessageStarted) {
              // Close THIS text block now so any following tool_use /
              // thinking block doesn't interleave inside an open bubble.
              emit({
                type: EventType.TEXT_MESSAGE_END,
                messageId: activeTextBlockId,
              });
              activeTextBlockId = null;
              textMessageStarted = false;
            } else if (activeTextBlockId) {
              // Empty text block (no text_delta arrived); nothing to close,
              // just clear the active marker.
              activeTextBlockId = null;
            } else if (reasoningMsgId && reasoningStarted && !reasoningEnded) {
              emit({
                type: EventType.REASONING_MESSAGE_END,
                messageId: reasoningMsgId,
              });
              reasoningEnded = true;
              reasoningMsgId = null;
              reasoningStarted = false;
            }
          }
        }
      } finally {
        // Lifecycle guarantee: every *_START we emit MUST be paired with a
        // matching *_END, even when the stream throws mid-token. Without
        // this, AG-UI clients tracking message-id / tool-call lifecycle
        // render a permanently in-flight assistant bubble, reasoning
        // bubble, or tool-call card.
        if (activeTextBlockId && textMessageStarted) {
          emit({
            type: EventType.TEXT_MESSAGE_END,
            messageId: activeTextBlockId,
          });
          activeTextBlockId = null;
          textMessageStarted = false;
        }
        if (reasoningMsgId && reasoningStarted && !reasoningEnded) {
          emit({
            type: EventType.REASONING_MESSAGE_END,
            messageId: reasoningMsgId,
          });
          reasoningEnded = true;
        }
        if (toolCallId) {
          emit({
            type: EventType.TOOL_CALL_END,
            toolCallId,
          });
          toolCallId = null;
          toolCallName = null;
          toolCallArgs = "";
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

// @region[state-streaming-middleware]
function partialJsonStringProperty(source: string, key: string): string | null {
  try {
    const parsed = PartialJSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const SHARED_STATE_STREAMING_SYSTEM_PROMPT =
  "You are a collaborative writing assistant. Whenever the user asks " +
  "you to write, draft, or revise text, call `write_document` with the " +
  "full content in the `document` argument. Do not paste the document " +
  "into the chat message directly; the UI renders shared state.";

const WRITE_DOCUMENT_TOOL_SCHEMA: Anthropic.Tool = {
  name: "write_document",
  description:
    "Write a document into shared agent state. Use for poems, emails, " +
    "summaries, explainers, and other drafted text.",
  input_schema: {
    type: "object",
    properties: {
      document: {
        type: "string",
        description: "The full document text to render in shared state.",
      },
    },
    required: ["document"],
  },
};
// @endregion[state-streaming-middleware]

/**
 * Run a single Anthropic Messages API call for a sub-agent. No tools,
 * no streaming — we just want the final text back so the supervisor can
 * read it on its next step. Mirrors `_invoke_sub_agent` in
 * `google-adk/src/agents/subagents_agent.py`.
 */
async function invokeSubAgent(
  systemPrompt: string,
  task: string,
  forwardedHeaders: Record<string, string> = {},
): Promise<string> {
  const response = await anthropic.messages.create(
    {
      model: SUBAGENT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: task }],
    },
    { headers: diagOutboundHeaders(forwardedHeaders) },
  );
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

interface BeautifulChatTodo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

function coerceBeautifulChatTodos(value: unknown): BeautifulChatTodo[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (todo): todo is Record<string, unknown> =>
        !!todo && typeof todo === "object",
    )
    .map((todo) => ({
      id: typeof todo.id === "string" && todo.id ? todo.id : randomUUID(),
      title: typeof todo.title === "string" ? todo.title : "",
      description: typeof todo.description === "string" ? todo.description : "",
      emoji: typeof todo.emoji === "string" && todo.emoji ? todo.emoji : "*",
      status: todo.status === "completed" ? "completed" : "pending",
    }));
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
// @region[backend-tool-execution]
async function executeBackendTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  state: Record<string, unknown>,
  emit: (event: object) => void,
  forwardedHeaders: Record<string, string> = {},
  agentContext: string = "",
): Promise<ExecuteToolResult> {
  if (toolName === "query_data") {
    const query = typeof toolInput.query === "string" ? toolInput.query : "";
    return {
      resultText: JSON.stringify(queryDataImpl(query)),
      state: null,
    };
  }

  if (toolName === "manage_todos") {
    const todos = coerceBeautifulChatTodos(toolInput.todos);
    return {
      resultText: JSON.stringify({ status: "updated", count: todos.length }),
      state: { ...state, todos },
    };
  }

  if (toolName === "get_todos") {
    return {
      resultText: JSON.stringify(coerceBeautifulChatTodos(state.todos)),
      state: null,
    };
  }

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

  if (toolName === "generate_a2ui") {
    const context =
      typeof toolInput.context === "string" ? toolInput.context : "";
    return {
      resultText: await generateDeclarativeA2uiOperations(
        context,
        forwardedHeaders,
        agentContext,
      ),
      state: null,
    };
  }

  // @region[weather-tool-backend]
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
    // Echo value-carrying args when the model provides them (the
    // tool-rendering aimock fixtures pass price_usd/change_pct so the
    // card and the narration agree); fall back to the canned impl.
    const base = getStockPriceImpl(ticker);
    const result = {
      ...base,
      ...(typeof toolInput.price_usd === "number"
        ? { price_usd: toolInput.price_usd }
        : {}),
      ...(typeof toolInput.change_pct === "number"
        ? { change_pct: toolInput.change_pct }
        : {}),
    };
    return {
      resultText: JSON.stringify(result),
      state: null,
    };
  }

  if (toolName === "search_flights") {
    if (Array.isArray(toolInput.flights)) {
      return {
        resultText: JSON.stringify(
          renderFlightsImpl(toolInput.flights as Flight[]),
        ),
        state: null,
      };
    }
    const origin = typeof toolInput.origin === "string" ? toolInput.origin : "";
    const destination =
      typeof toolInput.destination === "string" ? toolInput.destination : "";
    return {
      resultText: JSON.stringify(searchFlightsByRouteImpl(origin, destination)),
      state: null,
    };
  }

  if (toolName === "roll_d20") {
    const value =
      typeof toolInput.value === "number" ? toolInput.value : undefined;
    return {
      resultText: JSON.stringify(rollD20Impl(value)),
      state: null,
    };
  }

  if (toolName === "roll_dice") {
    const sides = typeof toolInput.sides === "number" ? toolInput.sides : 6;
    return {
      resultText: JSON.stringify(rollDiceImpl(sides)),
      state: null,
    };
  }

  if (toolName === "set_steps") {
    // Gen UI (Agent-based): each call REPLACES state.steps wholesale
    // (last-write-wins, mirroring the langgraph-typescript reducer). Keep
    // the raw step objects — the UI consumes { id, title, status } as-is.
    const steps = Array.isArray(toolInput.steps)
      ? (toolInput.steps as unknown[]).filter(
          (s): s is Record<string, unknown> => !!s && typeof s === "object",
        )
      : [];
    const next = { ...state, steps };
    return {
      resultText: JSON.stringify({ status: "ok", count: steps.length }),
      state: next,
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

  if (toolName === "write_document") {
    const document =
      typeof toolInput.document === "string" ? toolInput.document : "";
    const next = { ...state, document };
    return {
      resultText: JSON.stringify({ status: "ok", length: document.length }),
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
        forwardedHeaders,
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
// @endregion[backend-tool-execution]

interface AgenticLoopConfig {
  systemPrompt: string;
  toolSchemas: Anthropic.Tool[];
  initialState: Record<string, unknown>;
  /** Override the model for every call in the loop (defaults to
   *  CLAUDE_MODEL). Used by tool-rendering-reasoning-chain, which needs
   *  a thinking-capable model. */
  model?: string;
  /**
   * Enable Anthropic extended thinking and forward `thinking_delta`
   * events as AG-UI REASONING_MESSAGE_* events (same mapping as
   * `makeAgentHandler`). Note: the loop replays only text + tool_use
   * blocks into subsequent turns — sufficient for aimock-backed demo
   * runs; a real-API multi-leg thinking run would additionally require
   * replaying the signed thinking blocks.
   */
  enableThinking?: boolean;
  /**
   * Start each request from the newest user message only. This is required for
   * extended-thinking demos because AG-UI conversation history cannot replay
   * Anthropic's signed thinking blocks on a later HTTP request.
   */
  latestUserMessageOnly?: boolean;
}

/**
 * Run a full agentic loop: stream Claude, execute backend tools when
 * the model emits tool_use blocks, push tool_result back into the
 * conversation, and continue until Claude stops calling tools.
 *
 * Used by the demos that own their tools server-side:
 * /shared-state-read-write, /subagents, /gen-ui-agent, /a2ui-fixed-schema,
 * /headless-complete, /tool-rendering, and /tool-rendering-reasoning-chain
 * (seven consumers; see the route wiring below). The default pass-through
 * handler stays unchanged — frontend-registered tools never reach this path.
 */
async function runAgenticLoop(
  req: Request,
  res: Response,
  config: AgenticLoopConfig,
): Promise<void> {
  const input = req.body as RunAgentInput;
  const accept = req.headers["accept"] ?? "";
  // See `makeAgentHandler` — same forwarding contract applies to the
  // agentic-loop demos (shared-state-read-write, subagents, a2ui-fixed,
  // headless-complete). Without this, the secondary Anthropic calls
  // inside the loop (and the supervisor's stream) all miss
  // x-aimock-context and aimock returns 404.
  const forwardedHeaders = extractForwardedHeaders(req);

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
  const backendToolNames = new Set(config.toolSchemas.map((t) => t.name));
  const runtimeTools = buildTools(input.tools).filter(
    (tool) => !backendToolNames.has(tool.name),
  );
  const contextString = buildAgentContextString((input as any).context);
  const systemPrompt = appendContextToSystemPrompt(
    config.systemPrompt,
    contextString,
  );

  if (
    shouldUseClaudeAgentSdk({
      input,
      forwardedHeaders,
      runtimeToolCount: runtimeTools.length,
      enableThinking: config.enableThinking,
    })
  ) {
    await runWithClaudeAgentSdk({
      input,
      emit,
      runId,
      threadId,
      systemPrompt,
      toolSchemas: config.toolSchemas,
      initialState: state,
      model: config.model ?? CLAUDE_MODEL,
      forwardedHeaders,
      executeTool: (toolName, toolInput, currentState, toolEmit) =>
        executeBackendTool(
          toolName,
          toolInput,
          currentState,
          toolEmit,
          forwardedHeaders,
          contextString,
        ),
    });
    res.end();
    return;
  }

  try {
    emit({ type: EventType.RUN_STARTED, runId, threadId });

    const sourceMessages = config.latestUserMessageOnly
      ? latestUserMessageOnly(input.messages ?? [])
      : (input.messages ?? []);
    const messages = buildAnthropicMessages(sourceMessages);
    // Merge runtime tools (frontend-registered via useFrontendTool /
    // useRenderTool) with the demo's backend tools. The supervisor / RW
    // agent therefore still works alongside any frontend tool the demo
    // page chooses to register.
    const tools: Anthropic.Tool[] = [...config.toolSchemas, ...runtimeTools];

    // Maximum tool iterations per run. The supervisor demo can fan out
    // to research -> write -> critique, but we cap turns to prevent a
    // misbehaving model from running unbounded.
    const MAX_TOOL_ITERATIONS = 10;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const msgId = randomUUID();
      const pendingToolCalls: Array<{
        id: string;
        name: string;
        argsJson: string;
      }> = [];
      let activeToolCallId: string | null = null;
      let activeToolCallName: string | null = null;
      let activeToolArgs = "";
      let lastStreamedDocument =
        typeof (state as Record<string, unknown>).document === "string"
          ? ((state as Record<string, unknown>).document as string)
          : "";
      let reasoningMsgId: string | null = null;
      let reasoningStarted = false;
      // Per-content-block ordered array (R3-A8): Claude's canonical
      // pattern for tool-use turns under extended thinking is
      // "thinking → text → tool_use → text → tool_use" (which
      // tool-rendering-reasoning-chain explicitly trains for). We
      // accumulate ONE entry per content block in original stream order
      // and replay it as `assistantContent` below — both aimock strict
      // mode and the real Anthropic API reject the continuation
      // otherwise. Merging text from multiple blocks into a single
      // accumulator (or buckets keyed by type) reorders the turn on
      // replay and breaks content-order verification.
      //
      // Each thinking block carries its own signature (per-content-block
      // signed); each text block carries its own optional id so we can
      // emit per-block TEXT_MESSAGE_* lifecycles (R3-A9). Tool_use
      // entries are appended at content_block_stop alongside being
      // pushed to `pendingToolCalls`.
      type AssistantBlock =
        | { kind: "text"; messageId: string; text: string; started: boolean }
        | { kind: "thinking"; thinking: string; signature: string }
        | { kind: "tool_use"; id: string; name: string; argsJson: string };
      const assistantBlocks: AssistantBlock[] = [];
      let activeTextBlock: Extract<AssistantBlock, { kind: "text" }> | null =
        null;
      let activeThinkingBlock: Extract<
        AssistantBlock,
        { kind: "thinking" }
      > | null = null;

      try {
        const stream = await anthropic.messages.stream(
          {
            model: config.model ?? CLAUDE_MODEL,
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
          },
          { headers: diagOutboundHeaders(forwardedHeaders) },
        );

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
            } else if ((event.content_block as any).type === "text") {
              // Open a fresh text block. Each text content_block gets its
              // own AG-UI message lifecycle AND its own entry in the
              // ordered `assistantBlocks` replay array — preserving
              // text→tool_use→text order across multiple text blocks per
              // turn (R3-A8).
              activeTextBlock = {
                kind: "text",
                messageId: randomUUID(),
                text: "",
                started: false,
              };
            } else if (
              (event.content_block as any).type === "thinking" &&
              config.enableThinking
            ) {
              reasoningMsgId = randomUUID();
              reasoningStarted = false;
              activeThinkingBlock = {
                kind: "thinking",
                thinking: "",
                signature: "",
              };
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              if (!activeTextBlock) {
                // Defensive: text_delta arrived without a content_block_start
                // (legacy event ordering). Open a block on the fly so the
                // ordering contract still holds.
                activeTextBlock = {
                  kind: "text",
                  messageId: randomUUID(),
                  text: "",
                  started: false,
                };
              }
              if (!activeTextBlock.started) {
                emit({
                  type: EventType.TEXT_MESSAGE_START,
                  messageId: activeTextBlock.messageId,
                  role: "assistant",
                });
                activeTextBlock.started = true;
              }
              activeTextBlock.text += event.delta.text;
              emit({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: activeTextBlock.messageId,
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
                if (activeToolCallName === "write_document") {
                  const streamedDocument = partialJsonStringProperty(
                    activeToolArgs,
                    "document",
                  );
                  if (
                    streamedDocument !== null &&
                    streamedDocument !== lastStreamedDocument
                  ) {
                    state = { ...state, document: streamedDocument };
                    lastStreamedDocument = streamedDocument;
                    emit({ type: EventType.STATE_SNAPSHOT, snapshot: state });
                  }
                }
              }
            } else if (
              (event.delta as any).type === "thinking_delta" &&
              config.enableThinking &&
              reasoningMsgId
            ) {
              const delta = (event.delta as any).thinking as string;
              if (activeThinkingBlock) {
                activeThinkingBlock.thinking += delta;
              }
              if (!reasoningStarted) {
                emit({
                  type: EventType.REASONING_MESSAGE_START,
                  messageId: reasoningMsgId,
                  role: "reasoning",
                });
                reasoningStarted = true;
              }
              emit({
                type: EventType.REASONING_MESSAGE_CONTENT,
                messageId: reasoningMsgId,
                delta,
              });
            } else if (
              (event.delta as any).type === "signature_delta" &&
              config.enableThinking &&
              activeThinkingBlock
            ) {
              activeThinkingBlock.signature += ((event.delta as any)
                .signature ?? "") as string;
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
              // Preserve block-order: append tool_use to the ordered
              // replay array at the moment its content block closes, so
              // a "text → tool_use → text" stream replays in that exact
              // order rather than "all-text → all-tool_use".
              assistantBlocks.push({
                kind: "tool_use",
                id: activeToolCallId,
                name: activeToolCallName,
                argsJson: activeToolArgs,
              });
              activeToolCallId = null;
              activeToolCallName = null;
              activeToolArgs = "";
            } else if (activeTextBlock) {
              // Close this text block now (R3-A9): emit TEXT_MESSAGE_END
              // for every text block that STARTED — including genuinely
              // empty-string blocks the client already saw START/END for
              // (R3-A10). Append to the ordered replay array unless the
              // block carries no signal at all (no START emitted AND
              // empty text), in which case it's a no-op for both UI and
              // replay.
              if (activeTextBlock.started) {
                emit({
                  type: EventType.TEXT_MESSAGE_END,
                  messageId: activeTextBlock.messageId,
                });
                assistantBlocks.push(activeTextBlock);
              } else if (activeTextBlock.text) {
                // Belt-and-suspenders: text accumulated without a START
                // (shouldn't happen given the delta path opens it), but
                // we'd still want the replay entry.
                assistantBlocks.push(activeTextBlock);
              }
              activeTextBlock = null;
            } else if (reasoningMsgId && reasoningStarted) {
              emit({
                type: EventType.REASONING_MESSAGE_END,
                messageId: reasoningMsgId,
              });
              reasoningMsgId = null;
              reasoningStarted = false;
              if (activeThinkingBlock) {
                assistantBlocks.push(activeThinkingBlock);
                activeThinkingBlock = null;
              }
            } else if (activeThinkingBlock) {
              // Thinking block stopped before any thinking_delta arrived
              // (e.g. zero-token thinking). Preserve it for replay so the
              // continuation turn keeps the same block sequence Claude
              // produced.
              assistantBlocks.push(activeThinkingBlock);
              activeThinkingBlock = null;
            }
          }
        }
      } finally {
        // Lifecycle guarantee: every *_START we emit MUST be paired with a
        // matching *_END, even if anthropic.messages.stream throws
        // mid-token. Without this, the AG-UI client renders a permanently
        // in-flight assistant bubble, reasoning bubble, or tool-call card.
        // The outer try/catch still emits RUN_ERROR for the caller to
        // surface the failure.
        if (activeTextBlock && activeTextBlock.started) {
          emit({
            type: EventType.TEXT_MESSAGE_END,
            messageId: activeTextBlock.messageId,
          });
          assistantBlocks.push(activeTextBlock);
          activeTextBlock = null;
        } else if (activeTextBlock) {
          activeTextBlock = null;
        }
        if (reasoningMsgId && reasoningStarted) {
          emit({
            type: EventType.REASONING_MESSAGE_END,
            messageId: reasoningMsgId,
          });
          reasoningMsgId = null;
          reasoningStarted = false;
        }
        if (activeToolCallId) {
          emit({
            type: EventType.TOOL_CALL_END,
            toolCallId: activeToolCallId,
          });
          activeToolCallId = null;
          activeToolCallName = null;
          activeToolArgs = "";
        }
      }

      // No tool calls — we're done.
      if (pendingToolCalls.length === 0) {
        break;
      }

      // Append the assistant turn (thinking + text + tool_use blocks) to
      // the conversation so the next call sees the supervisor's plan.
      //
      // `assistantBlocks` preserves Claude's original stream order across
      // all three block kinds (thinking / text / tool_use), so a turn
      // shaped "thinking → text → tool_use → text → tool_use" replays in
      // that exact order rather than the all-text-then-all-tool_use
      // shape the prior single-accumulator code produced (R3-A8). Both
      // aimock strict mode and the real Anthropic API verify content
      // order on the continuation turn.
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      for (const block of assistantBlocks) {
        if (block.kind === "thinking") {
          if (!config.enableThinking) continue;
          // Signature-only blocks (zero-thinking but signed) are real:
          // Anthropic verifies signatures per content block, so a block
          // preserved at content_block_stop with empty `thinking` but a
          // non-empty `signature` must still be replayed to keep the per-
          // block ordering contract. Only skip blocks that are entirely
          // empty (no thinking, no signature) — those carry no state.
          if (!block.thinking && !block.signature) continue;
          assistantContent.push({
            type: "thinking",
            thinking: block.thinking,
            signature: block.signature,
          } as Anthropic.ContentBlockParam);
        } else if (block.kind === "text") {
          // Replay parity (R3-A10): include genuinely-empty-string text
          // blocks that emitted START/CONTENT/END to the client, so the
          // conversation history matches what the UI rendered. Drop only
          // blocks that never STARTED and carry no text — those produced
          // nothing on either side.
          if (!block.started && !block.text) continue;
          assistantContent.push({ type: "text", text: block.text });
        } else if (block.kind === "tool_use") {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = block.argsJson ? JSON.parse(block.argsJson) : {};
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
              `[agent_server] failed to parse streamed tool args for ${block.name} (id=${block.id}); replaying with empty input. error=${message}`,
            );
          }
          assistantContent.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: parsed,
          });
        }
      }
      messages.push({ role: "assistant", content: assistantContent });

      // Execute backend tools and push their tool_result blocks. Frontend
      // tools (anything not in `backendToolNames`) are NOT executed here
      // — they're meant to be handled by the AG-UI client. The frontend-tool
      // branch is LOAD-BEARING for /headless-complete, whose `highlight_note`
      // flow is registered on the frontend (see the route wiring below) and
      // depends on this branch breaking the agentic loop so the AG-UI client
      // can execute and re-invoke. Other consumers (e.g. /tool-rendering)
      // also benefit from the defensive merging when their pages register
      // additional `useFrontendTool` calls.
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
        const exec = await executeBackendTool(
          tc.name,
          parsed,
          state,
          emit,
          forwardedHeaders,
          contextString,
        );
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

// Beautiful Chat — flagship combined runtime. This cell mixes backend-owned
// tools (query_data, search_flights, generate_a2ui, manage_todos) with
// frontend tools (charts, scheduleTime, toggleTheme, enableAppMode) and MCP
// apps. Run it through the agentic loop so backend tools produce tool results
// and state snapshots instead of being left as unresolved frontend calls.
app.post(
  "/beautiful-chat",
  async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RunAgentInput;
    const incomingState =
      ((input as any).state as Record<string, unknown> | undefined) ?? {};
    await runAgenticLoop(req, res, {
      systemPrompt: BEAUTIFUL_CHAT_SYSTEM_PROMPT,
      toolSchemas: [
        QUERY_DATA_TOOL_SCHEMA,
        MANAGE_TODOS_TOOL_SCHEMA,
        GET_TODOS_TOOL_SCHEMA,
        BEAUTIFUL_CHAT_SEARCH_FLIGHTS_TOOL_SCHEMA,
        GENERATE_A2UI_TOOL_SCHEMA,
      ] as Anthropic.Tool[],
      initialState: {
        todos: coerceBeautifulChatTodos(incomingState.todos),
      },
    });
  },
);

// Reasoning demos — enable Anthropic extended-thinking and forward
// `thinking_delta` events as AG-UI REASONING_MESSAGE_* events. The
const CLAUDE_REASONING_MODEL =
  process.env.CLAUDE_REASONING_MODEL || CLAUDE_MODEL;
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

// @region[shared-state-streaming-route]
// Shared State Streaming — mirror LangGraph's state-streaming middleware by
// copying Claude's streamed write_document argument into shared state on each
// input_json_delta, then emitting the final snapshot when the tool completes.
app.post(
  "/shared-state-streaming",
  async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RunAgentInput;
    const incomingState =
      ((input as any).state as Record<string, unknown> | undefined) ?? {};
    await runAgenticLoop(req, res, {
      systemPrompt: SHARED_STATE_STREAMING_SYSTEM_PROMPT,
      toolSchemas: [WRITE_DOCUMENT_TOOL_SCHEMA] as Anthropic.Tool[],
      initialState: {
        document:
          typeof incomingState.document === "string"
            ? incomingState.document
            : "",
      },
    });
  },
);
// @endregion[shared-state-streaming-route]

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

// Gen UI (Agent-based) — backend owns the `set_steps` tool. The model
// plans 3 steps and calls set_steps after every status transition
// (~7 calls per run, see the fixture chain in
// showcase/aimock/d6/claude-sdk-typescript/gen-ui-agent.json); each call
// replaces `state.steps` and is streamed to the UI via STATE_SNAPSHOT so
// the InlineAgentStateCard animates pending -> in_progress -> completed.
// Without this dedicated endpoint the demo used the pass-through handler:
// the model's set_steps call was forwarded to the frontend (which
// registers no such tool), the tool result never materialized, and the
// multi-leg loop never completed.
app.post(
  "/gen-ui-agent",
  async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RunAgentInput;
    const incomingState =
      ((input as any).state as Record<string, unknown> | undefined) ?? {};
    const steps = Array.isArray(incomingState.steps) ? incomingState.steps : [];
    await runAgenticLoop(req, res, {
      systemPrompt: GEN_UI_AGENT_SYSTEM_PROMPT,
      toolSchemas: [SET_STEPS_TOOL_SCHEMA] as Anthropic.Tool[],
      initialState: { steps },
    });
  },
);

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

// Declarative Generative UI (A2UI Dynamic Schema) - backend owns
// generate_a2ui, then uses a secondary Claude call to produce render_a2ui
// args and returns them as an a2ui_operations container.
app.post(
  "/declarative-gen-ui",
  async (req: Request, res: Response): Promise<void> => {
    await runAgenticLoop(req, res, {
      systemPrompt: A2UI_DYNAMIC_SYSTEM_PROMPT,
      toolSchemas: [GENERATE_A2UI_TOOL_SCHEMA] as Anthropic.Tool[],
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

// Tool Rendering (+ default/custom catchall variants) — the pages register
// RENDER-ONLY hooks (useRenderTool / useDefaultRenderTool) with no handlers,
// so on the pass-through the model's tool calls were forwarded to the
// frontend, no result ever materialized, and every card sat in its loading
// state forever. Backend owns the four tools here (same treatment as
// /headless-complete and /gen-ui-agent); all three demo agents point at
// this endpoint from the main runtime route.
app.post(
  "/tool-rendering",
  async (req: Request, res: Response): Promise<void> => {
    await runAgenticLoop(req, res, {
      systemPrompt: TOOL_RENDERING_SYSTEM_PROMPT,
      toolSchemas: [
        HEADLESS_GET_WEATHER_TOOL_SCHEMA,
        HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
        SEARCH_FLIGHTS_TOOL_SCHEMA,
        ROLL_D20_TOOL_SCHEMA,
      ] as Anthropic.Tool[],
      initialState: {},
    });
  },
);

// Tool Rendering — Reasoning Chain. Same backend-owned-tools treatment as
// /tool-rendering, plus extended thinking on a reasoning-capable model so
// the demo's reasoning-block renders between chained tool calls
// (stocks AAPL→MSFT, dice d20→d6, flights→destination weather).
app.post(
  "/tool-rendering-reasoning-chain",
  async (req: Request, res: Response): Promise<void> => {
    await runAgenticLoop(req, res, {
      systemPrompt: REASONING_CHAIN_SYSTEM_PROMPT,
      toolSchemas: [
        HEADLESS_GET_WEATHER_TOOL_SCHEMA,
        HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA,
        SEARCH_FLIGHTS_TOOL_SCHEMA,
        ROLL_DICE_TOOL_SCHEMA,
      ] as Anthropic.Tool[],
      initialState: {},
      model: CLAUDE_REASONING_MODEL,
      enableThinking: true,
      latestUserMessageOnly: true,
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
