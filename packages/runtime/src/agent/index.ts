import type {
  BaseEvent,
  RunAgentInput,
  Message,
  ReasoningEndEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningMessageStartEvent,
  ReasoningStartEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageChunkEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
  ToolCallResultEvent,
  RunErrorEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import type {
  LanguageModel,
  ModelMessage,
  AssistantModelMessage,
  UserModelMessage,
  ToolModelMessage,
  SystemModelMessage,
  ToolCallPart,
  ToolResultPart,
  TextPart,
  ImagePart,
  FilePart,
  ToolChoice,
  ToolSet,
} from "ai";
import { streamText, tool as createVercelAISDKTool, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";
import { Observable } from "rxjs";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { safeParseToolArgs } from "@copilotkit/shared";
import { z } from "zod";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import { schemaToJsonSchema } from "@copilotkit/shared";
import { jsonSchema as aiJsonSchema } from "ai";
import { convertAISDKStream } from "./converters/aisdk";
import { convertTanStackStream } from "./converters/tanstack";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { randomUUID } from "@copilotkit/shared";

/**
 * Properties that can be overridden by forwardedProps
 * These match the exact parameter names in streamText
 */
export type OverridableProperty =
  | "model"
  | "toolChoice"
  | "maxOutputTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "presencePenalty"
  | "frequencyPenalty"
  | "stopSequences"
  | "seed"
  | "maxRetries"
  | "prompt"
  | "providerOptions";

/**
 * Supported model identifiers for BuiltInAgent
 */
export type BuiltInAgentModel =
  // OpenAI models
  | "openai/gpt-5"
  | "openai/gpt-5-mini"
  | "openai/gpt-4.1"
  | "openai/gpt-4.1-mini"
  | "openai/gpt-4.1-nano"
  | "openai/gpt-4o"
  | "openai/gpt-4o-mini"
  // OpenAI reasoning series
  | "openai/o3"
  | "openai/o3-mini"
  | "openai/o4-mini"
  // Anthropic (Claude) models
  | "anthropic/claude-sonnet-4.5"
  | "anthropic/claude-sonnet-4"
  | "anthropic/claude-3.7-sonnet"
  | "anthropic/claude-opus-4.1"
  | "anthropic/claude-opus-4"
  | "anthropic/claude-3.5-haiku"
  // Google (Gemini) models
  | "google/gemini-2.5-pro"
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-flash-lite"
  // Allow any LanguageModel instance
  | (string & {});

/**
 * Model specifier - can be a string like "openai/gpt-4o" or a LanguageModel instance
 */
export type ModelSpecifier = string | LanguageModel;

/**
 * MCP Client configuration for HTTP transport
 */
export interface MCPClientConfigHTTP {
  /** Type of MCP client */
  type: "http";
  /** URL of the MCP server */
  url: string;
  /**
   * Optional transport options for the underlying
   * `StreamableHTTPClientTransport`. The SDK's documented extension point
   * for per-request customization is `options.fetch` — pass a wrapped fetch
   * here if you need static + dynamic headers on outbound MCP requests.
   */
  options?: StreamableHTTPClientTransportOptions;
}

/**
 * MCP Client configuration for SSE transport
 */
export interface MCPClientConfigSSE {
  /** Type of MCP client */
  type: "sse";
  /** URL of the MCP server */
  url: string;
  /** Optional HTTP headers (e.g., for authentication) */
  headers?: Record<string, string>;
}

/**
 * MCP Client configuration
 */
export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigSSE;

/**
 * A user-managed MCP client that provides tools to the agent.
 * The user is responsible for creating, configuring, and closing the client.
 * Compatible with the return type of @ai-sdk/mcp's createMCPClient().
 *
 * Unlike mcpServers, the agent does NOT create or close these clients.
 * This allows persistent connections, custom auth, and tool caching.
 */
export interface MCPClientProvider {
  /** Return tools to be merged into the agent's tool set. */
  tools(): Promise<ToolSet>;
}

/**
 * Resolves a model specifier to a LanguageModel instance
 * @param spec - Model string (e.g., "openai/gpt-4o") or LanguageModel instance
 * @param apiKey - Optional API key to use instead of environment variables
 * @returns LanguageModel instance
 */
export function resolveModel(
  spec: ModelSpecifier,
  apiKey?: string,
): LanguageModel {
  // If already a LanguageModel instance, pass through
  if (typeof spec !== "string") {
    return spec;
  }

  // Normalize "provider/model" or "provider:model" format
  const normalized = spec.replace("/", ":").trim();
  const parts = normalized.split(":");
  const rawProvider = parts[0];
  const rest = parts.slice(1);

  if (!rawProvider) {
    throw new Error(
      `Invalid model string "${spec}". Use "openai/gpt-5", "anthropic/claude-sonnet-4.5", or "google/gemini-2.5-pro".`,
    );
  }

  const provider = rawProvider.toLowerCase();
  const model = rest.join(":").trim();

  if (!model) {
    throw new Error(
      `Invalid model string "${spec}". Use "openai/gpt-5", "anthropic/claude-sonnet-4.5", or "google/gemini-2.5-pro".`,
    );
  }

  switch (provider) {
    case "openai": {
      // Lazily create OpenAI provider
      // Use provided apiKey, or fall back to environment variable
      const openai = createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY!,
      });
      // Accepts any OpenAI model id, e.g. "gpt-4o", "gpt-4.1-mini", "o3-mini"
      return openai(model);
    }

    case "anthropic": {
      // Lazily create Anthropic provider
      // Use provided apiKey, or fall back to environment variable
      const anthropic = createAnthropic({
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY!,
      });
      // Accepts any Claude id, e.g. "claude-3.7-sonnet", "claude-3.5-haiku"
      return anthropic(model);
    }

    case "google":
    case "gemini":
    case "google-gemini": {
      // Lazily create Google provider
      // Use provided apiKey, or fall back to environment variable
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || process.env.GOOGLE_API_KEY!,
      });
      // Accepts any Gemini id, e.g. "gemini-2.5-pro", "gemini-2.5-flash"
      return google(model);
    }

    case "vertex": {
      const vertex = createVertex();
      return vertex(model);
    }

    default:
      throw new Error(
        `Unknown provider "${provider}" in "${spec}". Supported: openai, anthropic, google (gemini).`,
      );
  }
}

/**
 * Tool definition for BuiltInAgent
 */
export interface ToolDefinition<
  TParameters extends StandardSchemaV1 = StandardSchemaV1,
> {
  name: string;
  description: string;
  parameters: TParameters;
  execute: (args: InferSchemaOutput<TParameters>) => Promise<unknown>;
}

/**
 * Define a tool for use with BuiltInAgent
 * @param name - The name of the tool
 * @param description - Description of what the tool does
 * @param parameters - Schema for the tool's input parameters (any Standard Schema V1 compatible library: Zod, Valibot, ArkType, etc.)
 * @param execute - Function to execute the tool server-side
 * @returns Tool definition
 */
export function defineTool<TParameters extends StandardSchemaV1>(config: {
  name: string;
  description: string;
  parameters: TParameters;
  execute: (args: InferSchemaOutput<TParameters>) => Promise<unknown>;
}): ToolDefinition<TParameters> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  };
}

type AGUIUserMessage = Extract<Message, { role: "user" }>;

/**
 * Converts AG-UI user message content to Vercel AI SDK UserContent format.
 * Handles plain strings, new modality-specific parts (image/audio/video/document),
 * and legacy BinaryInputContent for backward compatibility.
 */
function convertUserMessageContent(
  content: AGUIUserMessage["content"],
): string | Array<TextPart | ImagePart | FilePart> {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  const parts: Array<TextPart | ImagePart | FilePart> = [];

  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      continue;
    }

    switch (part.type) {
      case "text": {
        const text = (part as { text?: string }).text;
        if (text) {
          parts.push({ type: "text", text });
        }
        break;
      }

      case "image": {
        const source = (part as { source?: any }).source;
        if (!source) break;
        if (source.type === "data") {
          parts.push({
            type: "image",
            image: source.value,
            mediaType: source.mimeType,
          });
        } else if (source.type === "url") {
          try {
            parts.push({
              type: "image",
              image: new URL(source.value),
              mediaType: source.mimeType,
            });
          } catch {
            console.error(
              `[CopilotKit] convertUserMessageContent: invalid URL "${source.value}" in image part — skipping`,
            );
          }
        }
        break;
      }

      case "audio":
      case "video":
      case "document": {
        const source = (part as { source?: any }).source;
        if (!source) break;
        if (source.type === "data") {
          parts.push({
            type: "file",
            data: source.value,
            mediaType: source.mimeType,
          });
        } else if (source.type === "url") {
          try {
            parts.push({
              type: "file",
              data: new URL(source.value),
              mediaType: source.mimeType ?? "application/octet-stream",
            });
          } catch {
            console.error(
              `[CopilotKit] convertUserMessageContent: invalid URL "${source.value}" in ${part.type} part — skipping`,
            );
          }
        }
        break;
      }

      // Legacy BinaryInputContent backward compatibility
      case "binary": {
        const legacy = part as {
          mimeType?: string;
          data?: string;
          url?: string;
        };
        const mimeType = legacy.mimeType ?? "application/octet-stream";
        const isImage = mimeType.startsWith("image/");

        if (legacy.data) {
          if (isImage) {
            parts.push({
              type: "image",
              image: legacy.data,
              mediaType: mimeType,
            });
          } else {
            parts.push({
              type: "file",
              data: legacy.data,
              mediaType: mimeType,
            });
          }
        } else if (legacy.url) {
          try {
            const url = new URL(legacy.url);
            if (isImage) {
              parts.push({ type: "image", image: url, mediaType: mimeType });
            } else {
              parts.push({ type: "file", data: url, mediaType: mimeType });
            }
          } catch {
            console.error(
              `[CopilotKit] convertUserMessageContent: invalid URL "${legacy.url}" in binary part — skipping`,
            );
          }
        }
        break;
      }

      default: {
        console.error(
          `[CopilotKit] convertUserMessageContent: unrecognized content part type "${(part as { type: string }).type}" — skipping`,
        );
        break;
      }
    }
  }

  return parts.length > 0 ? parts : "";
}

/**
 * Options for converting AG-UI messages to Vercel AI SDK format
 */
export interface MessageConversionOptions {
  forwardSystemMessages?: boolean;
  forwardDeveloperMessages?: boolean;
}

/**
 * Converts AG-UI messages to Vercel AI SDK ModelMessage format
 */
export function convertMessagesToVercelAISDKMessages(
  messages: Message[],
  options: MessageConversionOptions = {},
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "system" && options.forwardSystemMessages) {
      const systemMsg: SystemModelMessage = {
        role: "system",
        content: message.content ?? "",
      };
      result.push(systemMsg);
    } else if (
      message.role === "developer" &&
      options.forwardDeveloperMessages
    ) {
      const systemMsg: SystemModelMessage = {
        role: "system",
        content: message.content ?? "",
      };
      result.push(systemMsg);
    } else if (message.role === "assistant") {
      const parts: Array<TextPart | ToolCallPart> = message.content
        ? [{ type: "text", text: message.content }]
        : [];

      for (const toolCall of message.toolCalls ?? []) {
        const toolCallPart: ToolCallPart = {
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: safeParseToolArgs(toolCall.function.arguments),
        };
        parts.push(toolCallPart);
      }

      const assistantMsg: AssistantModelMessage = {
        role: "assistant",
        content: parts,
      };
      result.push(assistantMsg);
    } else if (message.role === "user") {
      const userMsg: UserModelMessage = {
        role: "user",
        content: convertUserMessageContent(message.content),
      };
      result.push(userMsg);
    } else if (message.role === "tool") {
      let toolName = "unknown";
      // Find the tool name from the corresponding tool call
      for (const msg of messages) {
        if (msg.role === "assistant") {
          for (const toolCall of msg.toolCalls ?? []) {
            if (toolCall.id === message.toolCallId) {
              toolName = toolCall.function.name;
              break;
            }
          }
        }
      }

      const toolResultPart: ToolResultPart = {
        type: "tool-result",
        toolCallId: message.toolCallId,
        toolName: toolName,
        output: {
          type: "text",
          value: message.content,
        },
      };

      const toolMsg: ToolModelMessage = {
        role: "tool",
        content: [toolResultPart],
      };
      result.push(toolMsg);
    }
  }

  return result;
}

/**
 * JSON Schema type definition
 */
interface JsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

/**
 * Converts JSON Schema to Zod schema
 */
export function convertJsonSchemaToZodSchema(
  jsonSchema: JsonSchema,
  required: boolean,
): z.ZodSchema {
  // Handle empty schemas {} (no input required) - treat as empty object
  if (!jsonSchema.type) {
    return required ? z.object({}) : z.object({}).optional();
  }
  if (jsonSchema.type === "object") {
    const spec: { [key: string]: z.ZodSchema } = {};

    if (!jsonSchema.properties || !Object.keys(jsonSchema.properties).length) {
      return !required ? z.object(spec).optional() : z.object(spec);
    }

    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      spec[key] = convertJsonSchemaToZodSchema(
        value,
        jsonSchema.required ? jsonSchema.required.includes(key) : false,
      );
    }
    const schema = z.object(spec).describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    if (jsonSchema.enum && jsonSchema.enum.length > 0) {
      const schema = z
        .enum(jsonSchema.enum as [string, ...string[]])
        .describe(jsonSchema.description ?? "");
      return required ? schema : schema.optional();
    }
    const schema = z.string().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    const schema = z.number().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    const schema = z.boolean().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    if (!jsonSchema.items) {
      throw new Error("Array type must have items property");
    }
    const itemSchema = convertJsonSchemaToZodSchema(jsonSchema.items, true);
    const schema = z.array(itemSchema).describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  }
  console.error("Invalid JSON schema:", JSON.stringify(jsonSchema, null, 2));
  throw new Error("Invalid JSON schema");
}

/**
 * Converts AG-UI tools to Vercel AI SDK ToolSet
 */
function isJsonSchema(obj: unknown): obj is JsonSchema {
  if (typeof obj !== "object" || obj === null) return false;
  const schema = obj as Record<string, unknown>;
  // Empty objects {} are valid JSON schemas (no input required)
  if (Object.keys(schema).length === 0) return true;
  return (
    typeof schema.type === "string" &&
    ["object", "string", "number", "integer", "boolean", "array"].includes(
      schema.type,
    )
  );
}

export function convertToolsToVercelAITools(
  tools: RunAgentInput["tools"],
): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const tool of tools) {
    if (!isJsonSchema(tool.parameters)) {
      throw new Error(`Invalid JSON schema for tool ${tool.name}`);
    }
    const zodSchema = convertJsonSchemaToZodSchema(tool.parameters, true);
    result[tool.name] = createVercelAISDKTool({
      description: tool.description,
      inputSchema: zodSchema,
    });
  }

  return result;
}

/**
 * Check whether a schema is a Zod schema by inspecting its Standard Schema vendor.
 */
function isZodSchema(schema: StandardSchemaV1): boolean {
  return schema["~standard"]?.vendor === "zod";
}

/**
 * Converts ToolDefinition array to Vercel AI SDK ToolSet.
 *
 * For Zod schemas, passes them directly to the AI SDK (Zod satisfies FlexibleSchema).
 * For non-Zod schemas, converts to JSON Schema via schemaToJsonSchema() and wraps
 * with the AI SDK's jsonSchema() helper.
 */
export function convertToolDefinitionsToVercelAITools(
  tools: ToolDefinition[],
): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const tool of tools) {
    if (isZodSchema(tool.parameters)) {
      // Zod schemas can be passed directly to AI SDK (satisfies FlexibleSchema)
      result[tool.name] = createVercelAISDKTool({
        description: tool.description,
        inputSchema: tool.parameters as any,
        execute: tool.execute,
      });
    } else {
      // Non-Zod: convert to JSON Schema and wrap with AI SDK's jsonSchema()
      const jsonSchemaObj = schemaToJsonSchema(tool.parameters);
      result[tool.name] = createVercelAISDKTool({
        description: tool.description,
        inputSchema: aiJsonSchema(jsonSchemaObj),
        execute: tool.execute,
      });
    }
  }

  return result;
}

/**
 * Context passed to the user-supplied factory function in factory mode.
 */
export interface AgentFactoryContext {
  input: RunAgentInput;
  /**
   * Prefer `abortSignal` for most use cases (AI SDK, fetch, custom backends).
   * Provided for backends like TanStack AI that require the full AbortController.
   * Do NOT call `.abort()` on this controller — use `abortRun()` on the agent instead.
   */
  abortController: AbortController;
  abortSignal: AbortSignal;
}

/**
 * Factory config for AI SDK backend.
 * The factory must return an object with a `fullStream` async iterable
 * (compatible with the result of `streamText()` — only `fullStream` is consumed).
 */
export interface BuiltInAgentAISDKFactoryConfig {
  type: "aisdk";
  factory: (
    ctx: AgentFactoryContext,
  ) =>
    | { fullStream: AsyncIterable<unknown> }
    | Promise<{ fullStream: AsyncIterable<unknown> }>;
}

/**
 * Factory config for TanStack AI backend.
 * The factory must return an async iterable of TanStack AI stream chunks.
 */
export interface BuiltInAgentTanStackFactoryConfig {
  type: "tanstack";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
}

/**
 * Factory config for a custom backend that directly yields AG-UI events.
 */
export interface BuiltInAgentCustomFactoryConfig {
  type: "custom";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<BaseEvent> | Promise<AsyncIterable<BaseEvent>>;
}

/**
 * Union of all factory-mode configurations.
 */
export type BuiltInAgentFactoryConfig =
  | BuiltInAgentAISDKFactoryConfig
  | BuiltInAgentTanStackFactoryConfig
  | BuiltInAgentCustomFactoryConfig;

/**
 * Classic config — BuiltInAgent handles streamText, tools, MCP, state tools, prompt building.
 */
export interface BuiltInAgentClassicConfig {
  /**
   * The model to use
   */
  model: BuiltInAgentModel | LanguageModel;
  /**
   * API key for the model provider (OpenAI, Anthropic, Google)
   * If not provided, falls back to environment variables:
   * - OPENAI_API_KEY for OpenAI models
   * - ANTHROPIC_API_KEY for Anthropic models
   * - GOOGLE_API_KEY for Google models
   */
  apiKey?: string;
  /**
   * Maximum number of steps/iterations for tool calling (default: 1)
   */
  maxSteps?: number;
  /**
   * Tool choice setting - how tools are selected for execution (default: "auto")
   */
  toolChoice?: ToolChoice<Record<string, unknown>>;
  /**
   * Maximum number of tokens to generate
   */
  maxOutputTokens?: number;
  /**
   * Temperature setting (range depends on provider)
   */
  temperature?: number;
  /**
   * Nucleus sampling (topP)
   */
  topP?: number;
  /**
   * Top K sampling
   */
  topK?: number;
  /**
   * Presence penalty
   */
  presencePenalty?: number;
  /**
   * Frequency penalty
   */
  frequencyPenalty?: number;
  /**
   * Sequences that will stop the generation
   */
  stopSequences?: string[];
  /**
   * Seed for deterministic results
   */
  seed?: number;
  /**
   * Maximum number of retries
   */
  maxRetries?: number;
  /**
   * Prompt for the agent
   */
  prompt?: string;
  /**
   * List of properties that can be overridden by forwardedProps.
   */
  overridableProperties?: OverridableProperty[];
  /**
   * Optional list of MCP server configurations
   */
  mcpServers?: MCPClientConfig[];
  /**
   * Optional list of user-managed MCP clients.
   * Unlike mcpServers, the agent does NOT create or close these clients.
   * The user controls the lifecycle, persistence, auth, and caching.
   *
   * Compatible with @ai-sdk/mcp's createMCPClient() return type:
   * ```typescript
   * const client = await createMCPClient({ transport });
   * const agent = new BuiltInAgent({ model: "...", mcpClients: [client] });
   * ```
   */
  mcpClients?: MCPClientProvider[];
  /**
   * Optional tools available to the agent
   */
  tools?: ToolDefinition[];
  /**
   * Forward system-role messages from input to the LLM.
   * Default: false
   */
  forwardSystemMessages?: boolean;
  /**
   * Forward developer-role messages from input to the LLM (as system messages).
   * Default: false
   */
  forwardDeveloperMessages?: boolean;
  /**
   * Provider-specific options passed to the model (e.g., OpenAI reasoningEffort).
   * Example: `{ openai: { reasoningEffort: "high" } }`
   */
  providerOptions?: Record<string, any>;
  /**
   * Explicit agent capabilities. **Shallow-merged** at the category level on
   * top of auto-inferred defaults — providing a category (e.g. `tools`)
   * replaces that entire category, not individual fields within it.
   *
   * For example, `{ tools: { supported: true } }` will drop the inferred
   * `clientProvided` value. Include all fields for any category you override.
   */
  capabilities?: Partial<AgentCapabilities>;
}

/**
 * Configuration for BuiltInAgent.
 *
 * Two modes:
 * - **Classic** (model + params): BuiltInAgent handles everything — streamText, tools, MCP, state tools.
 * - **Factory** (type + factory): You own the LLM call. BuiltInAgent handles lifecycle only.
 */
export type BuiltInAgentConfiguration =
  | BuiltInAgentClassicConfig
  | BuiltInAgentFactoryConfig;

/**
 * Type guard: returns true if this is a factory-mode config.
 */
function isFactoryConfig(
  config: BuiltInAgentConfiguration,
): config is BuiltInAgentFactoryConfig {
  return "factory" in config;
}

export class BuiltInAgent extends AbstractAgent {
  private abortController?: AbortController;

  constructor(private config: BuiltInAgentConfiguration) {
    super();
  }

  /**
   * Check if a property can be overridden by forwardedProps
   */
  canOverride(property: OverridableProperty): boolean {
    if (isFactoryConfig(this.config)) return false;
    return this.config?.overridableProperties?.includes(property) ?? false;
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    const inferred: AgentCapabilities = {
      tools: {
        supported: true,
        clientProvided: true,
      },
      transport: {
        streaming: true,
      },
    };

    if (!this.config.capabilities) {
      return inferred;
    }

    // Shallow merge at the category level — explicit overrides replace
    // entire categories when provided, inferred defaults fill the rest.
    return {
      ...inferred,
      ...this.config.capabilities,
    };
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    if (isFactoryConfig(this.config)) {
      return this.runFactory(input, this.config);
    }

    if (this.abortController) {
      throw new Error(
        "Agent is already running. Call abortRun() first or create a new instance.",
      );
    }

    // Set synchronously before Observable creation to close TOCTOU window
    this.abortController = new AbortController();
    const abortController = this.abortController;

    return new Observable<BaseEvent>((subscriber) => {
      // Emit RUN_STARTED event
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      subscriber.next(startEvent);

      // Resolve the model, passing API key if provided
      const model = resolveModel(this.config.model, this.config.apiKey);

      // Build prompt based on conditions
      let systemPrompt: string | undefined = undefined;

      // Check if we should build a prompt:
      // - config.prompt is set, OR
      // - input.context is non-empty, OR
      // - input.state is non-empty and not an empty object
      const hasPrompt = !!this.config.prompt;
      const hasContext = input.context && input.context.length > 0;
      const hasState =
        input.state !== undefined &&
        input.state !== null &&
        !(
          typeof input.state === "object" &&
          Object.keys(input.state).length === 0
        );

      if (hasPrompt || hasContext || hasState) {
        const parts: string[] = [];

        // First: the prompt if any
        if (hasPrompt) {
          parts.push(this.config.prompt!);
        }

        // Second: context from the application
        if (hasContext) {
          parts.push("\n## Context from the application\n");
          for (const ctx of input.context) {
            parts.push(`${ctx.description}:\n${ctx.value}\n`);
          }
        }

        // Third: state from the application that can be edited
        if (hasState) {
          parts.push(
            "\n## Application State\n" +
              "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
              `\`\`\`json\n${JSON.stringify(input.state, null, 2)}\n\`\`\`\n`,
          );
        }

        systemPrompt = parts.join("");
      }

      // Convert messages and prepend system message if we have a prompt
      const messages = convertMessagesToVercelAISDKMessages(input.messages, {
        forwardSystemMessages: this.config.forwardSystemMessages,
        forwardDeveloperMessages: this.config.forwardDeveloperMessages,
      });
      if (systemPrompt) {
        messages.unshift({
          role: "system",
          content: systemPrompt,
        });
      }

      // Merge tools from input and config
      let allTools: ToolSet = convertToolsToVercelAITools(input.tools);
      if (this.config.tools && this.config.tools.length > 0) {
        const configTools = convertToolDefinitionsToVercelAITools(
          this.config.tools,
        );
        allTools = { ...allTools, ...configTools };
      }

      const streamTextParams: Parameters<typeof streamText>[0] = {
        model,
        messages,
        tools: allTools,
        toolChoice: this.config.toolChoice,
        stopWhen: this.config.maxSteps
          ? stepCountIs(this.config.maxSteps)
          : undefined,
        maxOutputTokens: this.config.maxOutputTokens,
        temperature: this.config.temperature,
        topP: this.config.topP,
        topK: this.config.topK,
        presencePenalty: this.config.presencePenalty,
        frequencyPenalty: this.config.frequencyPenalty,
        stopSequences: this.config.stopSequences,
        seed: this.config.seed,
        providerOptions: this.config.providerOptions,
        maxRetries: this.config.maxRetries,
      };

      // Apply forwardedProps overrides (if allowed)
      if (input.forwardedProps && typeof input.forwardedProps === "object") {
        const props = input.forwardedProps as Record<string, unknown>;

        // Check and apply each overridable property
        if (props.model !== undefined && this.canOverride("model")) {
          if (
            typeof props.model === "string" ||
            typeof props.model === "object"
          ) {
            // Accept any string or LanguageModel instance for model override
            // Use the configured API key when resolving overridden models
            streamTextParams.model = resolveModel(
              props.model as string | LanguageModel,
              this.config.apiKey,
            );
          }
        }
        if (props.toolChoice !== undefined && this.canOverride("toolChoice")) {
          // ToolChoice can be 'auto', 'required', 'none', or { type: 'tool', toolName: string }
          const toolChoice = props.toolChoice;
          if (
            toolChoice === "auto" ||
            toolChoice === "required" ||
            toolChoice === "none" ||
            (typeof toolChoice === "object" &&
              toolChoice !== null &&
              "type" in toolChoice &&
              toolChoice.type === "tool")
          ) {
            streamTextParams.toolChoice = toolChoice as ToolChoice<
              Record<string, unknown>
            >;
          }
        }
        if (
          typeof props.maxOutputTokens === "number" &&
          this.canOverride("maxOutputTokens")
        ) {
          streamTextParams.maxOutputTokens = props.maxOutputTokens;
        }
        if (
          typeof props.temperature === "number" &&
          this.canOverride("temperature")
        ) {
          streamTextParams.temperature = props.temperature;
        }
        if (typeof props.topP === "number" && this.canOverride("topP")) {
          streamTextParams.topP = props.topP;
        }
        if (typeof props.topK === "number" && this.canOverride("topK")) {
          streamTextParams.topK = props.topK;
        }
        if (
          typeof props.presencePenalty === "number" &&
          this.canOverride("presencePenalty")
        ) {
          streamTextParams.presencePenalty = props.presencePenalty;
        }
        if (
          typeof props.frequencyPenalty === "number" &&
          this.canOverride("frequencyPenalty")
        ) {
          streamTextParams.frequencyPenalty = props.frequencyPenalty;
        }
        if (
          Array.isArray(props.stopSequences) &&
          this.canOverride("stopSequences")
        ) {
          // Validate all elements are strings
          if (
            props.stopSequences.every(
              (item): item is string => typeof item === "string",
            )
          ) {
            streamTextParams.stopSequences = props.stopSequences;
          }
        }
        if (typeof props.seed === "number" && this.canOverride("seed")) {
          streamTextParams.seed = props.seed;
        }
        if (
          typeof props.maxRetries === "number" &&
          this.canOverride("maxRetries")
        ) {
          streamTextParams.maxRetries = props.maxRetries;
        }
        if (
          props.providerOptions !== undefined &&
          this.canOverride("providerOptions")
        ) {
          if (
            typeof props.providerOptions === "object" &&
            props.providerOptions !== null
          ) {
            streamTextParams.providerOptions = props.providerOptions as Record<
              string,
              any
            >;
          }
        }
      }

      // Set up MCP clients if configured and process the stream
      const mcpClients: MCPClient[] = [];

      (async () => {
        let terminalEventEmitted = false;
        let messageId = randomUUID();
        let reasoningMessageId = randomUUID();
        let isInReasoning = false;

        // Auto-close an open reasoning lifecycle.
        // Some AI SDK providers (notably @ai-sdk/anthropic) never emit "reasoning-end",
        // which leaves downstream state machines stuck. This helper emits the
        // missing REASONING_MESSAGE_END + REASONING_END events so the stream
        // can transition to text, tool-call, or finish phases.
        // Declared before try/catch so it is accessible in the catch block.
        const closeReasoningIfOpen = () => {
          if (!isInReasoning) return;
          isInReasoning = false;
          const reasoningMsgEnd: ReasoningMessageEndEvent = {
            type: EventType.REASONING_MESSAGE_END,
            messageId: reasoningMessageId,
          };
          subscriber.next(reasoningMsgEnd);
          const reasoningEnd: ReasoningEndEvent = {
            type: EventType.REASONING_END,
            messageId: reasoningMessageId,
          };
          subscriber.next(reasoningEnd);
        };

        try {
          // Add AG-UI state update tools
          streamTextParams.tools = {
            ...streamTextParams.tools,
            AGUISendStateSnapshot: createVercelAISDKTool({
              description:
                "Replace the entire application state with a new snapshot",
              inputSchema: z.object({
                snapshot: z.any().describe("The complete new state object"),
              }),
              execute: async ({ snapshot }) => {
                return { success: true, snapshot };
              },
            }),
            AGUISendStateDelta: createVercelAISDKTool({
              description:
                "Apply incremental updates to application state using JSON Patch operations",
              inputSchema: z.object({
                delta: z
                  .array(
                    z.object({
                      op: z
                        .enum(["add", "replace", "remove"])
                        .describe("The operation to perform"),
                      path: z
                        .string()
                        .describe("JSON Pointer path (e.g., '/foo/bar')"),
                      value: z
                        .any()
                        .optional()
                        .describe(
                          "The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'.",
                        ),
                    }),
                  )
                  .describe("Array of JSON Patch operations"),
              }),
              execute: async ({ delta }) => {
                return { success: true, delta };
              },
            }),
          };

          // Merge tools from user-managed MCP clients (user controls lifecycle)
          if (this.config.mcpClients && this.config.mcpClients.length > 0) {
            for (const client of this.config.mcpClients) {
              const mcpTools = await client.tools();
              streamTextParams.tools = {
                ...streamTextParams.tools,
                ...mcpTools,
              } as ToolSet;
            }
          }

          // Initialize MCP clients and get their tools.
          //
          // Servers come from two sources, concatenated in order:
          //   - `config.mcpServers` — user-supplied static array.
          //   - The CopilotKit Intelligence MCP server, auto-attached when
          //     the runtime forwards a `copilotkitIntelligence` bag via
          //     `input.forwardedProps.auth`. The bag carries `userId` +
          //     `apiKey` + `mcpUrl`. We build a per-request
          //     MCPClientConfigHTTP whose `options.fetch` closes over
          //     `apiKey` + `userId` and stamps
          //     `Authorization: Bearer <apiKey>` and `X-Cpki-User-Id:
          //     <userId>` on every outbound MCP call. Skipped when the user
          //     already configured a server pointing at the same URL. The
          //     `auth` namespace is the convention for credentials that
          //     downstream redaction policies strip before durable storage
          //     and FE replay.
          const allMcpServers: MCPClientConfig[] = [
            ...(this.config.mcpServers ?? []),
          ];
          const auth = (
            input.forwardedProps as
              | { auth?: { copilotkitIntelligence?: unknown } }
              | undefined
          )?.auth;
          const cki = auth?.copilotkitIntelligence as
            | { userId?: unknown; apiKey?: unknown; mcpUrl?: unknown }
            | undefined;
          const ckiUserId =
            typeof cki?.userId === "string" ? cki.userId : undefined;
          const ckiApiKey =
            typeof cki?.apiKey === "string" ? cki.apiKey : undefined;
          const ckiMcpUrl =
            typeof cki?.mcpUrl === "string" ? cki.mcpUrl : undefined;
          if (
            ckiUserId &&
            ckiApiKey &&
            ckiMcpUrl &&
            !allMcpServers.some((s) => s.type === "http" && s.url === ckiMcpUrl)
          ) {
            allMcpServers.push({
              type: "http",
              url: ckiMcpUrl,
              options: {
                fetch: async (req, init) => {
                  const headers = new Headers(init?.headers);
                  headers.set("Authorization", `Bearer ${ckiApiKey}`);
                  headers.set("X-Cpki-User-Id", ckiUserId);
                  return globalThis.fetch(req, { ...init, headers });
                },
              },
            });
          }
          if (allMcpServers.length > 0) {
            for (const serverConfig of allMcpServers) {
              let transport;

              if (serverConfig.type === "http") {
                const url = new URL(serverConfig.url);
                transport = new StreamableHTTPClientTransport(
                  url,
                  serverConfig.options,
                );
              } else if (serverConfig.type === "sse") {
                transport = new SSEClientTransport(
                  new URL(serverConfig.url),
                  serverConfig.headers,
                );
              }

              if (transport) {
                const mcpClient = await createMCPClient({ transport });
                mcpClients.push(mcpClient);

                // Get tools from this MCP server and merge with existing tools
                const mcpTools = await mcpClient.tools();
                streamTextParams.tools = {
                  ...streamTextParams.tools,
                  ...mcpTools,
                } as ToolSet;
              }
            }
          }

          // Call streamText and process the stream
          const response = streamText({
            ...streamTextParams,
            abortSignal: abortController.signal,
          });

          const toolCallStates = new Map<
            string,
            {
              started: boolean;
              hasArgsDelta: boolean;
              ended: boolean;
              toolName?: string;
            }
          >();

          const ensureToolCallState = (toolCallId: string) => {
            let state = toolCallStates.get(toolCallId);
            if (!state) {
              state = { started: false, hasArgsDelta: false, ended: false };
              toolCallStates.set(toolCallId, state);
            }
            return state;
          };

          // Process fullStream events
          for await (const part of response.fullStream) {
            // Close any open reasoning lifecycle on every event except
            // reasoning-delta, which arrives mid-block and must not interrupt it.
            if (part.type !== "reasoning-delta") {
              closeReasoningIfOpen();
            }

            switch (part.type) {
              case "abort": {
                const abortEndEvent: RunFinishedEvent = {
                  type: EventType.RUN_FINISHED,
                  threadId: input.threadId,
                  runId: input.runId,
                };
                subscriber.next(abortEndEvent);
                terminalEventEmitted = true;

                // Complete the observable
                subscriber.complete();
                break;
              }
              case "reasoning-start": {
                // Use SDK-provided id, or generate a fresh UUID if the id is falsy,
                // "0", or matches the non-unique pattern emitted by @ai-sdk/openai-compatible
                // (e.g. "txt-0", "reasoning-0", "msg-0").
                const providedId = "id" in part ? part.id : undefined;
                const isNonUniqueId =
                  !providedId ||
                  providedId === "0" ||
                  /^(txt|reasoning|msg)-0$/.test(providedId);
                reasoningMessageId = isNonUniqueId
                  ? randomUUID()
                  : (providedId as typeof reasoningMessageId);
                const reasoningStartEvent: ReasoningStartEvent = {
                  type: EventType.REASONING_START,
                  messageId: reasoningMessageId,
                };
                subscriber.next(reasoningStartEvent);
                const reasoningMessageStart: ReasoningMessageStartEvent = {
                  type: EventType.REASONING_MESSAGE_START,
                  messageId: reasoningMessageId,
                  role: "reasoning",
                };
                subscriber.next(reasoningMessageStart);
                isInReasoning = true;
                break;
              }
              case "reasoning-delta": {
                const delta = part.text ?? "";
                if (!delta) break; // skip — @ag-ui/core schema requires delta to be non-empty
                const reasoningDeltaEvent: ReasoningMessageContentEvent = {
                  type: EventType.REASONING_MESSAGE_CONTENT,
                  messageId: reasoningMessageId,
                  delta,
                };
                subscriber.next(reasoningDeltaEvent);
                break;
              }
              case "reasoning-end": {
                // closeReasoningIfOpen() already called before the switch — no-op here
                // if the SDK never emits this event (e.g. @ai-sdk/anthropic).
                break;
              }
              case "tool-input-start": {
                const toolCallId = part.id;
                const state = ensureToolCallState(toolCallId);
                state.toolName = part.toolName;
                if (!state.started) {
                  state.started = true;
                  const startEvent: ToolCallStartEvent = {
                    type: EventType.TOOL_CALL_START,
                    parentMessageId: messageId,
                    toolCallId,
                    toolCallName: part.toolName,
                  };
                  subscriber.next(startEvent);
                }
                break;
              }

              case "tool-input-delta": {
                const toolCallId = part.id;
                const state = ensureToolCallState(toolCallId);
                state.hasArgsDelta = true;
                const argsEvent: ToolCallArgsEvent = {
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId,
                  delta: part.delta,
                };
                subscriber.next(argsEvent);
                break;
              }

              case "tool-input-end": {
                // No direct event – the subsequent "tool-call" part marks completion.
                break;
              }

              case "text-start": {
                // New text message starting - use the SDK-provided id
                // Use randomUUID() if part.id is falsy, "0", or matches the non-unique
                // pattern emitted by @ai-sdk/openai-compatible (e.g. "txt-0", "msg-0").
                const providedId = "id" in part ? part.id : undefined;
                const isNonUniqueTextId =
                  !providedId ||
                  providedId === "0" ||
                  /^(txt|reasoning|msg)-0$/.test(providedId);
                messageId = isNonUniqueTextId
                  ? randomUUID()
                  : (providedId as typeof messageId);
                break;
              }

              case "text-delta": {
                // Accumulate text content - in AI SDK 5.0, the property is 'text'
                const textDelta = "text" in part ? part.text : "";
                // Emit text chunk event
                const textEvent: TextMessageChunkEvent = {
                  type: EventType.TEXT_MESSAGE_CHUNK,
                  role: "assistant",
                  messageId,
                  delta: textDelta,
                };
                subscriber.next(textEvent);
                break;
              }

              case "tool-call": {
                const toolCallId = part.toolCallId;
                const state = ensureToolCallState(toolCallId);
                state.toolName = part.toolName ?? state.toolName;

                if (!state.started) {
                  state.started = true;
                  const startEvent: ToolCallStartEvent = {
                    type: EventType.TOOL_CALL_START,
                    parentMessageId: messageId,
                    toolCallId,
                    toolCallName: part.toolName,
                  };
                  subscriber.next(startEvent);
                }

                if (
                  !state.hasArgsDelta &&
                  "input" in part &&
                  part.input !== undefined
                ) {
                  let serializedInput = "";
                  if (typeof part.input === "string") {
                    serializedInput = part.input;
                  } else {
                    try {
                      serializedInput = JSON.stringify(part.input);
                    } catch {
                      serializedInput = String(part.input);
                    }
                  }

                  if (serializedInput.length > 0) {
                    const argsEvent: ToolCallArgsEvent = {
                      type: EventType.TOOL_CALL_ARGS,
                      toolCallId,
                      delta: serializedInput,
                    };
                    subscriber.next(argsEvent);
                    state.hasArgsDelta = true;
                  }
                }

                if (!state.ended) {
                  state.ended = true;
                  const endEvent: ToolCallEndEvent = {
                    type: EventType.TOOL_CALL_END,
                    toolCallId,
                  };
                  subscriber.next(endEvent);
                }
                break;
              }

              case "tool-result": {
                const toolResult =
                  "output" in part
                    ? part.output
                    : "result" in part
                      ? part.result
                      : null;
                const toolName = "toolName" in part ? part.toolName : "";
                toolCallStates.delete(part.toolCallId);

                // Check if this is a state update tool
                if (
                  toolName === "AGUISendStateSnapshot" &&
                  toolResult &&
                  typeof toolResult === "object"
                ) {
                  const snapshot = toolResult.snapshot;
                  if (snapshot !== undefined) {
                    const stateSnapshotEvent: StateSnapshotEvent = {
                      type: EventType.STATE_SNAPSHOT,
                      snapshot,
                    };
                    subscriber.next(stateSnapshotEvent);
                  }
                } else if (
                  toolName === "AGUISendStateDelta" &&
                  toolResult &&
                  typeof toolResult === "object"
                ) {
                  const delta = toolResult.delta;
                  if (delta !== undefined) {
                    const stateDeltaEvent: StateDeltaEvent = {
                      type: EventType.STATE_DELTA,
                      delta,
                    };
                    subscriber.next(stateDeltaEvent);
                  }
                }

                // Always emit the tool result event for the LLM
                let serializedResult: string;
                try {
                  serializedResult = JSON.stringify(toolResult);
                } catch {
                  serializedResult = `[Unserializable tool result from ${toolName || part.toolCallId}]`;
                }
                const resultEvent: ToolCallResultEvent = {
                  type: EventType.TOOL_CALL_RESULT,
                  role: "tool",
                  messageId: randomUUID(),
                  toolCallId: part.toolCallId,
                  content: serializedResult,
                };
                subscriber.next(resultEvent);
                break;
              }

              case "finish": {
                // Emit run finished event
                const finishedEvent: RunFinishedEvent = {
                  type: EventType.RUN_FINISHED,
                  threadId: input.threadId,
                  runId: input.runId,
                };
                subscriber.next(finishedEvent);
                terminalEventEmitted = true;

                // Complete the observable
                subscriber.complete();
                break;
              }

              case "error": {
                if (abortController.signal.aborted) {
                  break;
                }
                const err = part.error ?? part.message ?? part.cause;
                const runErrorEvent: RunErrorEvent = {
                  type: EventType.RUN_ERROR,
                  message:
                    err instanceof Error
                      ? err.message
                      : typeof err === "string"
                        ? err
                        : `AI SDK stream error: ${JSON.stringify(part)}`,
                  threadId: input.threadId,
                  runId: input.runId,
                } as RunErrorEvent;
                subscriber.next(runErrorEvent);
                terminalEventEmitted = true;

                // Handle error
                if (err instanceof Error) subscriber.error(err);
                else
                  subscriber.error(
                    new Error(
                      typeof err === "string" ? err : `AI SDK stream error`,
                    ),
                  );
                break;
              }
            }
          }

          if (!terminalEventEmitted) {
            closeReasoningIfOpen();
            if (abortController.signal.aborted) {
              // Let the runner finalize the stream on stop requests so it can
              // inject consistent closing events and a RUN_FINISHED marker.
            } else {
              const finishedEvent: RunFinishedEvent = {
                type: EventType.RUN_FINISHED,
                threadId: input.threadId,
                runId: input.runId,
              };
              subscriber.next(finishedEvent);
            }

            terminalEventEmitted = true;
            subscriber.complete();
          }
        } catch (error) {
          closeReasoningIfOpen();
          if (abortController.signal.aborted) {
            subscriber.complete();
          } else {
            const runErrorEvent: RunErrorEvent = {
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
              threadId: input.threadId,
              runId: input.runId,
            } as RunErrorEvent;
            subscriber.next(runErrorEvent);
            terminalEventEmitted = true;
            subscriber.error(error);
          }
        } finally {
          this.abortController = undefined;
          await Promise.all(mcpClients.map((client) => client.close()));
        }
      })();

      // Cleanup function
      return () => {
        // Cleanup MCP clients if stream is unsubscribed
        Promise.all(mcpClients.map((client) => client.close())).catch(() => {
          // Ignore cleanup errors
        });
      };
    });
  }

  private runFactory(
    input: RunAgentInput,
    config: BuiltInAgentFactoryConfig,
  ): Observable<BaseEvent> {
    if (this.abortController) {
      throw new Error(
        "Agent is already running. Call abortRun() first or create a new instance.",
      );
    }

    // Set synchronously before Observable creation to close TOCTOU window
    this.abortController = new AbortController();
    const controller = this.abortController;

    return new Observable<BaseEvent>((subscriber) => {
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      subscriber.next(startEvent);

      const ctx: AgentFactoryContext = {
        input,
        abortController: controller,
        abortSignal: controller.signal,
      };

      (async () => {
        try {
          let events: AsyncIterable<BaseEvent>;

          switch (config.type) {
            case "aisdk": {
              const result = await config.factory(ctx);
              events = convertAISDKStream(result.fullStream, controller.signal);
              break;
            }
            case "tanstack": {
              const stream = await config.factory(ctx);
              events = convertTanStackStream(stream, controller.signal);
              break;
            }
            case "custom": {
              events = await config.factory(ctx);
              break;
            }
            default: {
              const _exhaustive: never = config;
              throw new Error(
                `Unknown agent config type: ${(_exhaustive as BuiltInAgentFactoryConfig).type}`,
              );
            }
          }

          for await (const event of events) {
            subscriber.next(event);
          }

          if (!controller.signal.aborted) {
            const finishedEvent: RunFinishedEvent = {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            };
            subscriber.next(finishedEvent);
          }
          subscriber.complete();
        } catch (error) {
          if (controller.signal.aborted) {
            subscriber.complete();
          } else {
            const runErrorEvent: RunErrorEvent = {
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
              threadId: input.threadId,
              runId: input.runId,
            } as RunErrorEvent;
            subscriber.next(runErrorEvent);
            subscriber.error(error);
          }
        } finally {
          this.abortController = undefined;
        }
      })();

      return () => {
        controller.abort();
      };
    });
  }

  clone() {
    const cloned = new BuiltInAgent(this.config);
    // AbstractAgent.middlewares is private in @ag-ui/client — no public accessor exists.
    // This coupling is intentional: clone() must preserve middleware chains.
    // @ts-expect-error accessing private AbstractAgent.middlewares
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }

  abortRun(): void {
    this.abortController?.abort();
  }
}

/**
 * @deprecated Use BuiltInAgent instead
 */
export class BasicAgent extends BuiltInAgent {
  constructor(config: BuiltInAgentConfiguration) {
    super(config);
    console.warn("BasicAgent is deprecated, use BuiltInAgent instead");
  }
}

/** @deprecated Use BuiltInAgentClassicConfig instead */
export type BasicAgentConfiguration = BuiltInAgentClassicConfig;

export * from "./converters";
