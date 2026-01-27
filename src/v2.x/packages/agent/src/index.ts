import {
  AbstractAgent,
  BaseEvent,
  RunAgentInput,
  EventType,
  Message,
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
import {
  streamText,
  LanguageModel,
  ModelMessage,
  AssistantModelMessage,
  UserModelMessage,
  ToolModelMessage,
  SystemModelMessage,
  ToolCallPart,
  ToolResultPart,
  TextPart,
  tool as createVercelAISDKTool,
  ToolChoice,
  ToolSet,
  stepCountIs,
} from "ai";
import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import { Observable } from "rxjs";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

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
  | "prompt";

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
  /**
   * Type of MCP client
   */
  type: "http";
  /**
   * URL of the MCP server
   */
  url: string;
  /**
   * Optional transport options for HTTP client
   */
  options?: StreamableHTTPClientTransportOptions;
}

/**
 * MCP Client configuration for SSE transport
 */
export interface MCPClientConfigSSE {
  /**
   * Type of MCP client
   */
  type: "sse";
  /**
   * URL of the MCP server
   */
  url: string;
  /**
   * Optional HTTP headers (e.g., for authentication)
   */
  headers?: Record<string, string>;
}

/**
 * MCP Client configuration
 */
export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigSSE;

/**
 * Resolves a model specifier to a LanguageModel instance
 * @param spec - Model string (e.g., "openai/gpt-4o") or LanguageModel instance
 * @param apiKey - Optional API key to use instead of environment variables
 * @returns LanguageModel instance
 */
export function resolveModel(spec: ModelSpecifier, apiKey?: string): LanguageModel {
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

    default:
      throw new Error(`Unknown provider "${provider}" in "${spec}". Supported: openai, anthropic, google (gemini).`);
  }
}

/**
 * Tool definition for BuiltInAgent
 */
export interface ToolDefinition<TParameters extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: TParameters;
  execute: (args: z.infer<TParameters>) => Promise<unknown>;
}

/**
 * Define a tool for use with BuiltInAgent
 * @param name - The name of the tool
 * @param description - Description of what the tool does
 * @param parameters - Zod schema for the tool's input parameters
 * @param execute - Function to execute the tool server-side
 * @returns Tool definition
 */
export function defineTool<TParameters extends z.ZodTypeAny>(config: {
  name: string;
  description: string;
  parameters: TParameters;
  execute: (args: z.infer<TParameters>) => Promise<unknown>;
}): ToolDefinition<TParameters> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  };
}

type AGUIUserMessage = Extract<Message, { role: "user" }>;

function flattenUserMessageContent(content?: AGUIUserMessage["content"]): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
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
    } else if (message.role === "developer" && options.forwardDeveloperMessages) {
      const systemMsg: SystemModelMessage = {
        role: "system",
        content: message.content ?? "",
      };
      result.push(systemMsg);
    } else if (message.role === "assistant") {
      const parts: Array<TextPart | ToolCallPart> = message.content ? [{ type: "text", text: message.content }] : [];

      for (const toolCall of message.toolCalls ?? []) {
        const toolCallPart: ToolCallPart = {
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
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
        content: flattenUserMessageContent(message.content),
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
}

/**
 * Converts JSON Schema to Zod schema
 */
export function convertJsonSchemaToZodSchema(jsonSchema: JsonSchema, required: boolean): z.ZodSchema {
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
      spec[key] = convertJsonSchemaToZodSchema(value, jsonSchema.required ? jsonSchema.required.includes(key) : false);
    }
    let schema = z.object(spec).describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    let schema = z.string().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    let schema = z.number().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    let schema = z.boolean().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    if (!jsonSchema.items) {
      throw new Error("Array type must have items property");
    }
    let itemSchema = convertJsonSchemaToZodSchema(jsonSchema.items, true);
    let schema = z.array(itemSchema).describe(jsonSchema.description ?? "");
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
    ["object", "string", "number", "integer", "boolean", "array"].includes(schema.type)
  );
}

export function convertToolsToVercelAITools(tools: RunAgentInput["tools"]): ToolSet {
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
 * Converts ToolDefinition array to Vercel AI SDK ToolSet
 */
export function convertToolDefinitionsToVercelAITools(tools: ToolDefinition[]): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const tool of tools) {
    result[tool.name] = createVercelAISDKTool({
      description: tool.description,
      inputSchema: tool.parameters,
      execute: tool.execute,
    });
  }

  return result;
}

/**
 * Configuration for BuiltInAgent
 */
export interface BuiltInAgentConfiguration {
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
    return this.config?.overridableProperties?.includes(property) ?? false;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
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
        !(typeof input.state === "object" && Object.keys(input.state).length === 0);

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
        const configTools = convertToolDefinitionsToVercelAITools(this.config.tools);
        allTools = { ...allTools, ...configTools };
      }

      const streamTextParams: Parameters<typeof streamText>[0] = {
        model,
        messages,
        tools: allTools,
        toolChoice: this.config.toolChoice,
        stopWhen: this.config.maxSteps ? stepCountIs(this.config.maxSteps) : undefined,
        maxOutputTokens: this.config.maxOutputTokens,
        temperature: this.config.temperature,
        topP: this.config.topP,
        topK: this.config.topK,
        presencePenalty: this.config.presencePenalty,
        frequencyPenalty: this.config.frequencyPenalty,
        stopSequences: this.config.stopSequences,
        seed: this.config.seed,
        maxRetries: this.config.maxRetries,
      };

      // Apply forwardedProps overrides (if allowed)
      if (input.forwardedProps && typeof input.forwardedProps === "object") {
        const props = input.forwardedProps as Record<string, unknown>;

        // Check and apply each overridable property
        if (props.model !== undefined && this.canOverride("model")) {
          if (typeof props.model === "string" || typeof props.model === "object") {
            // Accept any string or LanguageModel instance for model override
            // Use the configured API key when resolving overridden models
            streamTextParams.model = resolveModel(props.model as string | LanguageModel, this.config.apiKey);
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
            streamTextParams.toolChoice = toolChoice as ToolChoice<Record<string, unknown>>;
          }
        }
        if (typeof props.maxOutputTokens === "number" && this.canOverride("maxOutputTokens")) {
          streamTextParams.maxOutputTokens = props.maxOutputTokens;
        }
        if (typeof props.temperature === "number" && this.canOverride("temperature")) {
          streamTextParams.temperature = props.temperature;
        }
        if (typeof props.topP === "number" && this.canOverride("topP")) {
          streamTextParams.topP = props.topP;
        }
        if (typeof props.topK === "number" && this.canOverride("topK")) {
          streamTextParams.topK = props.topK;
        }
        if (typeof props.presencePenalty === "number" && this.canOverride("presencePenalty")) {
          streamTextParams.presencePenalty = props.presencePenalty;
        }
        if (typeof props.frequencyPenalty === "number" && this.canOverride("frequencyPenalty")) {
          streamTextParams.frequencyPenalty = props.frequencyPenalty;
        }
        if (Array.isArray(props.stopSequences) && this.canOverride("stopSequences")) {
          // Validate all elements are strings
          if (props.stopSequences.every((item): item is string => typeof item === "string")) {
            streamTextParams.stopSequences = props.stopSequences;
          }
        }
        if (typeof props.seed === "number" && this.canOverride("seed")) {
          streamTextParams.seed = props.seed;
        }
        if (typeof props.maxRetries === "number" && this.canOverride("maxRetries")) {
          streamTextParams.maxRetries = props.maxRetries;
        }
      }

      // Set up MCP clients if configured and process the stream
      const mcpClients: Array<{ close: () => Promise<void> }> = [];

      (async () => {
        const abortController = new AbortController();
        this.abortController = abortController;
        let terminalEventEmitted = false;

        try {
          // Add AG-UI state update tools
          streamTextParams.tools = {
            ...streamTextParams.tools,
            AGUISendStateSnapshot: createVercelAISDKTool({
              description: "Replace the entire application state with a new snapshot",
              inputSchema: z.object({
                snapshot: z.any().describe("The complete new state object"),
              }),
              execute: async ({ snapshot }) => {
                return { success: true, snapshot };
              },
            }),
            AGUISendStateDelta: createVercelAISDKTool({
              description: "Apply incremental updates to application state using JSON Patch operations",
              inputSchema: z.object({
                delta: z
                  .array(
                    z.object({
                      op: z.enum(["add", "replace", "remove"]).describe("The operation to perform"),
                      path: z.string().describe("JSON Pointer path (e.g., '/foo/bar')"),
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

          // Initialize MCP clients and get their tools
          if (this.config.mcpServers && this.config.mcpServers.length > 0) {
            for (const serverConfig of this.config.mcpServers) {
              let transport;

              if (serverConfig.type === "http") {
                const url = new URL(serverConfig.url);
                transport = new StreamableHTTPClientTransport(url, serverConfig.options);
              } else if (serverConfig.type === "sse") {
                transport = new SSEClientTransport(new URL(serverConfig.url), serverConfig.headers);
              }

              if (transport) {
                const mcpClient = await createMCPClient({ transport });
                mcpClients.push(mcpClient);

                // Get tools from this MCP server and merge with existing tools
                const mcpTools = await mcpClient.tools();
                streamTextParams.tools = { ...streamTextParams.tools, ...mcpTools } as ToolSet;
              }
            }
          }

          // Call streamText and process the stream
          const response = streamText({ ...streamTextParams, abortSignal: abortController.signal });

          let messageId = randomUUID();

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
            switch (part.type) {
              case "abort":
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
                // Use randomUUID() if part.id is falsy or "0" to prevent message merging issues
                const providedId = "id" in part ? part.id : undefined;
                messageId = providedId && providedId !== "0" ? (providedId as typeof messageId) : randomUUID();
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

                if (!state.hasArgsDelta && "input" in part && part.input !== undefined) {
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
                const toolResult = "output" in part ? part.output : null;
                const toolName = "toolName" in part ? part.toolName : "";
                toolCallStates.delete(part.toolCallId);

                // Check if this is a state update tool
                if (toolName === "AGUISendStateSnapshot" && toolResult && typeof toolResult === "object") {
                  // Emit StateSnapshotEvent
                  const stateSnapshotEvent: StateSnapshotEvent = {
                    type: EventType.STATE_SNAPSHOT,
                    snapshot: toolResult.snapshot,
                  };
                  subscriber.next(stateSnapshotEvent);
                } else if (toolName === "AGUISendStateDelta" && toolResult && typeof toolResult === "object") {
                  // Emit StateDeltaEvent
                  const stateDeltaEvent: StateDeltaEvent = {
                    type: EventType.STATE_DELTA,
                    delta: toolResult.delta,
                  };
                  subscriber.next(stateDeltaEvent);
                }

                // Always emit the tool result event for the LLM
                const resultEvent: ToolCallResultEvent = {
                  type: EventType.TOOL_CALL_RESULT,
                  role: "tool",
                  messageId: randomUUID(),
                  toolCallId: part.toolCallId,
                  content: JSON.stringify(toolResult),
                };
                subscriber.next(resultEvent);
                break;
              }

              case "finish":
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

              case "error": {
                if (abortController.signal.aborted) {
                  break;
                }
                const runErrorEvent: RunErrorEvent = {
                  type: EventType.RUN_ERROR,
                  message: part.error + "",
                };
                subscriber.next(runErrorEvent);
                terminalEventEmitted = true;

                // Handle error
                subscriber.error(part.error);
                break;
              }
            }
          }

          if (!terminalEventEmitted) {
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
          if (abortController.signal.aborted) {
            subscriber.complete();
          } else {
            const runErrorEvent: RunErrorEvent = {
              type: EventType.RUN_ERROR,
              message: error + "",
            };
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

  clone() {
    const cloned = new BuiltInAgent(this.config);
    // Copy middlewares from parent class
    // @ts-expect-error - accessing protected property from parent
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

export type BasicAgentConfiguration = BuiltInAgentConfiguration;
