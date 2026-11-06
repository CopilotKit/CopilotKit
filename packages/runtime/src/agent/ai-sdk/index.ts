/**
 * `@copilotkit/runtime/agent/ai-sdk`: helpers for `type: "aisdk"` factories.
 *
 * This is the only runtime entry that imports `ai` at module scope. An app
 * that imports it uses the AI SDK, so `ai` must be installed.
 */
import { RENDER_A2UI_TOOL } from "@ag-ui/a2ui-middleware";
import type {
  ContentPart,
  Message,
  RunAgentInput,
  ToolMessage,
} from "@ag-ui/client";
import { Validator } from "@cfworker/json-schema";
import { safeParseToolArgs, schemaToJsonSchema } from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { AnyTool } from "@tanstack/ai";
import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolCallPart,
  ToolModelMessage,
  ToolResultPart,
  ToolSet,
  UserModelMessage,
} from "ai";
import { jsonSchema as aiJsonSchema, tool as createVercelAISDKTool } from "ai";
import { z } from "zod";
import type { ToolDefinition } from "../index";

export { createSafeUrlDownload } from "./url-download";
export type {
  CreateSafeUrlDownloadOptions,
  SafeUrlDownloadOptions,
} from "./url-download";

/**
 * A tool result or user part can name a provider file handle (`file` source).
 * It is neither bytes nor a URL, and the AI SDK cannot send it to the
 * provider, so the part is dropped with a warning.
 */
function warnDroppedFileSource(what: string) {
  console.warn(
    `[CopilotKit] Dropping a ${what} that references a provider file handle: it is not a URL or inline data, so it cannot be sent to the model here.`,
  );
}

/**
 * The AI SDK output for an AG-UI tool message.
 *
 * A text-only result is one text output. A URL part becomes its URL as text.
 * A result with inline media is a content list: the text entry first, when
 * there is any, then each media part with its bytes and media type. A
 * media-only result is media alone. A result whose parts were all dropped is
 * the empty string, because AG-UI 1.0 requires every call to be answered.
 */
function toolResultOutput(
  content: ToolMessage["content"],
): ToolResultPart["output"] {
  if (typeof content === "string") return { type: "text", value: content };
  const segments: string[] = [];
  const media: Array<{ type: "media"; data: string; mediaType: string }> = [];
  let open = false; // whether the last segment is text still being appended to
  for (const part of content) {
    if (part.type === "text") {
      if (open) segments[segments.length - 1] += part.text;
      else segments.push(part.text);
      open = true;
    } else if (part.source.type === "file") {
      warnDroppedFileSource(`${part.type} part in a tool result`);
    } else if (part.source.type === "url") {
      segments.push(part.source.value);
      open = false;
    } else {
      media.push({
        type: "media",
        data: part.source.value,
        mediaType: part.source.mimeType,
      });
      open = false;
    }
  }
  const text = segments.join("\n");
  if (media.length === 0) return { type: "text", value: text };
  return {
    type: "content",
    value: [
      ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
      ...media,
    ],
  };
}

type LegacyBinaryInputContent = {
  type: "binary";
  mimeType?: string;
  data?: string;
  url?: string;
};

/** A URL from the request, or `null` (logged) when it does not parse. */
function parseContentUrl(value: string, what: string) {
  try {
    return new URL(value);
  } catch {
    console.error(
      `[CopilotKit] convertUserMessageContent: invalid URL "${value}" in ${what} part, skipping`,
    );
    return null;
  }
}

/**
 * Converts AG-UI user message content to AI SDK user content: plain strings,
 * modality parts (image, audio, video, document), and the legacy `binary`
 * part.
 */
function convertUserMessageContent(
  content: string | Array<ContentPart | LegacyBinaryInputContent>,
): string | Array<TextPart | ImagePart | FilePart> {
  if (!content) return "";
  if (typeof content === "string") return content;

  const parts: Array<TextPart | ImagePart | FilePart> = [];

  for (const part of content) {
    // The request body is not validated, so a part can be anything.
    if (!part || typeof part !== "object" || !("type" in part)) continue;

    switch (part.type) {
      case "text": {
        if (part.text) parts.push({ type: "text", text: part.text });
        break;
      }

      case "image": {
        const { source } = part;
        if (!source) break;
        if (source.type === "data") {
          parts.push({
            type: "image",
            image: source.value,
            mediaType: source.mimeType,
          });
        } else if (source.type === "file") {
          warnDroppedFileSource("image part");
        } else {
          const url = parseContentUrl(source.value, "image");
          if (url) {
            parts.push({
              type: "image",
              image: url,
              mediaType: source.mimeType,
            });
          }
        }
        break;
      }

      case "audio":
      case "video":
      case "document": {
        const { source } = part;
        if (!source) break;
        if (source.type === "data") {
          parts.push({
            type: "file",
            data: source.value,
            mediaType: source.mimeType,
          });
        } else if (source.type === "file") {
          warnDroppedFileSource(`${part.type} part`);
        } else {
          const url = parseContentUrl(source.value, part.type);
          if (url) {
            parts.push({
              type: "file",
              data: url,
              mediaType: source.mimeType ?? "application/octet-stream",
            });
          }
        }
        break;
      }

      case "binary": {
        const mimeType = part.mimeType ?? "application/octet-stream";
        const isImage = mimeType.startsWith("image/");
        const data = part.data
          ? part.data
          : part.url
            ? parseContentUrl(part.url, "binary")
            : null;
        if (!data) break;
        parts.push(
          isImage
            ? { type: "image", image: data, mediaType: mimeType }
            : { type: "file", data, mediaType: mimeType },
        );
        break;
      }

      default: {
        const unknownPart: { type: string } = part;
        console.error(
          `[CopilotKit] convertUserMessageContent: unrecognized content part type "${unknownPart.type}", skipping`,
        );
        break;
      }
    }
  }

  return parts.length > 0 ? parts : "";
}

/**
 * Options for {@link convertMessagesToVercelAISDKMessages}.
 */
export interface MessageConversionOptions {
  /** Send AG-UI `system` messages to the model as system messages. */
  forwardSystemMessages?: boolean;
  /** Send AG-UI `developer` messages to the model as system messages. */
  forwardDeveloperMessages?: boolean;
}

/**
 * Converts AG-UI messages to AI SDK `ModelMessage`s, for `streamText` calls in
 * a `type: "aisdk"` factory.
 *
 * System and developer messages are dropped unless the matching option is on.
 * Tool results keep their text and inline media.
 *
 * @param messages - The run's AG-UI messages, usually `ctx.input.messages`.
 * @param options - Which system and developer messages to forward.
 *
 * ```ts
 * streamText({ model, messages: convertMessagesToVercelAISDKMessages(ctx.input.messages) })
 * ```
 */
export function convertMessagesToVercelAISDKMessages(
  messages: Message[],
  options: MessageConversionOptions = {},
) {
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

      const toolCalls = message.toolCalls ?? [];
      for (const toolCall of toolCalls) {
        parts.push({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: safeParseToolArgs(toolCall.function.arguments),
          ...(toolCall.encryptedValue
            ? {
                providerOptions: {
                  google: { thoughtSignature: toolCall.encryptedValue },
                },
              }
            : {}),
        });
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
      // The tool name comes from the assistant message that made the call.
      const toolName =
        messages
          .flatMap((msg) =>
            msg.role === "assistant" ? (msg.toolCalls ?? []) : [],
          )
          .find((toolCall) => toolCall.id === message.toolCallId)?.function
          .name ?? "unknown";

      const toolMsg: ToolModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName,
            output: toolResultOutput(message.content),
          },
        ],
      };
      result.push(toolMsg);
    }
  }

  return result;
}

/**
 * The JSON Schema subset that {@link convertJsonSchemaToZodSchema} reads.
 */
interface JsonSchema {
  type?:
    | "object"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  // Union combinators. A frontend tool authored with `z.discriminatedUnion`
  // (or any `z.union`) serializes to a node carrying `anyOf` / `oneOf` and
  // usually NO top-level `type`.
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

/**
 * Converts a JSON Schema to a Zod schema, for `type: "aisdk"` factories that
 * need a Zod schema for an AG-UI tool.
 *
 * @param jsonSchema - The schema: objects, strings (with `enum`), numbers,
 * integers, booleans, arrays, `null`, and `anyOf` / `oneOf` unions.
 * @param required - When false, the result is `.optional()`.
 * @throws Error for an array without `items` or a `type` it does not know.
 */
export function convertJsonSchemaToZodSchema(
  jsonSchema: JsonSchema,
  required: boolean,
): z.ZodSchema {
  // Zod 4 emits an empty `description` into JSON Schema; Zod 3's converters
  // dropped it. Only attach a description the JSON Schema actually had.
  const describe = <T extends z.ZodType>(schema: T): T =>
    jsonSchema.description ? schema.describe(jsonSchema.description) : schema;

  if (jsonSchema.type === "null") {
    const schema = describe(z.null());
    return required ? schema : schema.optional();
  }

  // Handle `anyOf` / `oneOf` unions (e.g. `z.discriminatedUnion` or `z.union`
  // on a frontend tool) as `z.union`. These nodes usually carry no top-level
  // `type`, so they MUST be handled before the empty-schema guard below.
  // Otherwise the union collapses to an empty object (`z.object({})`), the
  // reconstructed tool schema loses the union-typed field entirely, and the
  // model can never emit it. This is especially load-bearing for a union
  // nested inside array `items`, which OpenAI otherwise silently drops.
  const unionVariants = jsonSchema.anyOf ?? jsonSchema.oneOf;
  if (Array.isArray(unionVariants) && unionVariants.length > 0) {
    // A single-variant union is just that variant.
    if (unionVariants.length === 1) {
      return convertJsonSchemaToZodSchema(unionVariants[0], required);
    }
    const variantSchemas = unionVariants.map((variant) =>
      convertJsonSchemaToZodSchema(variant, true),
    );
    const schema = describe(
      z.union(variantSchemas as [z.ZodSchema, z.ZodSchema, ...z.ZodSchema[]]),
    );
    return required ? schema : schema.optional();
  }

  // Handle empty schemas {} (no input required) - treat as empty object
  if (!jsonSchema.type) {
    return required ? z.object({}) : z.object({}).optional();
  }
  if (jsonSchema.type === "object") {
    const spec: { [key: string]: z.ZodSchema } = {};

    if (!jsonSchema.properties || !Object.keys(jsonSchema.properties).length) {
      return !required ? z.object(spec).optional() : z.object(spec);
    }

    const requiredKeys = new Set(jsonSchema.required ?? []);
    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      spec[key] = convertJsonSchemaToZodSchema(value, requiredKeys.has(key));
    }
    const schema = describe(z.object(spec));
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    if (jsonSchema.enum && jsonSchema.enum.length > 0) {
      const schema = describe(z.enum(jsonSchema.enum as [string, ...string[]]));
      return required ? schema : schema.optional();
    }
    const schema = describe(z.string());
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    const schema = describe(z.number());
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    const schema = describe(z.boolean());
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    if (!jsonSchema.items) {
      throw new Error("Array type must have items property");
    }
    const itemSchema = convertJsonSchemaToZodSchema(jsonSchema.items, true);
    const schema = describe(z.array(itemSchema));
    return required ? schema : schema.optional();
  }
  console.error("Invalid JSON schema:", JSON.stringify(jsonSchema, null, 2));
  throw new Error("Invalid JSON schema");
}

const JSON_SCHEMA_TYPES = [
  "object",
  "string",
  "number",
  "integer",
  "boolean",
  "array",
];

function isJsonSchema(obj: unknown): obj is JsonSchema {
  if (typeof obj !== "object" || obj === null) return false;
  // Empty objects {} are valid JSON schemas (no input required)
  if (Object.keys(obj).length === 0) return true;
  return (
    "type" in obj &&
    typeof obj.type === "string" &&
    JSON_SCHEMA_TYPES.includes(obj.type)
  );
}

/**
 * Converts AG-UI tools (the run's frontend tools, `ctx.input.tools`) to an AI
 * SDK `ToolSet`, for `streamText` calls in a `type: "aisdk"` factory.
 *
 * The tools have no `execute`, so the AI SDK leaves their calls to the
 * client. Their JSON Schema goes to the model unchanged, and the arguments
 * are validated against it.
 *
 * @param tools - AG-UI tools whose `parameters` are JSON Schema objects.
 * @throws Error when a tool's `parameters` is not a JSON Schema object.
 *
 * ```ts
 * streamText({ model, tools: convertToolsToVercelAITools(ctx.input.tools) })
 * ```
 */
export function convertToolsToVercelAITools(tools: RunAgentInput["tools"]) {
  const result: ToolSet = {};

  for (const tool of tools) {
    if (!isJsonSchema(tool.parameters)) {
      throw new Error(`Invalid JSON schema for tool ${tool.name}`);
    }
    const validator = new Validator(tool.parameters, "7");
    result[tool.name] = createVercelAISDKTool({
      description: tool.description,
      // AG-UI already supplies JSON Schema. A Zod round trip loses open object
      // fields (including A2UI components), references, and other constraints.
      inputSchema: aiJsonSchema(tool.parameters, {
        validate: (value) => {
          const validation = validator.validate(value);
          return validation.valid
            ? { success: true, value }
            : {
                success: false,
                error: new Error(`Invalid arguments for tool ${tool.name}`),
              };
        },
      }),
      // A2UI components require open objects. Other tools keep the provider's
      // existing strictness default instead of opting every tool out.
      ...(tool.name === RENDER_A2UI_TOOL.name ? { strict: false } : {}),
    });
  }

  return result;
}

/** Whether a TanStack `inputSchema` is a Standard Schema (Zod, Valibot, ArkType). */
function isStandardSchema(
  schema: NonNullable<AnyTool["inputSchema"]>,
): schema is StandardSchemaV1 {
  return "~standard" in schema;
}

/**
 * The AI SDK input schema for a TanStack tool. No schema means no arguments.
 * A Standard Schema also validates the input, so `execute` gets the parsed
 * output (for example with Zod defaults applied), as in `chat()`.
 */
function toolInputSchema(name: string, schema: AnyTool["inputSchema"]) {
  if (!schema) return aiJsonSchema({ type: "object", properties: {} });
  if (!isStandardSchema(schema)) return aiJsonSchema(schema);
  return aiJsonSchema(schemaToJsonSchema(schema), {
    validate: async (value) => {
      const parsed = await schema["~standard"].validate(value);
      if ("value" in parsed) return { success: true, value: parsed.value };
      const details = parsed.issues.map((issue) => issue.message).join("; ");
      return {
        success: false,
        error: new Error(`Invalid arguments for tool ${name}: ${details}`),
      };
    },
  });
}

/**
 * Converts TanStack AI tools to an AI SDK `ToolSet`, for `streamText` calls in
 * a `type: "aisdk"` factory.
 *
 * - A tool with `execute` keeps it. The AI SDK runs it with the parsed input.
 * - A tool without `execute` stays client-side: the AI SDK leaves its calls
 *   to the client.
 * - `inputSchema` can be JSON Schema or a Standard Schema such as Zod.
 *
 * A typical use is the learned-skill tools of the run:
 *
 * ```ts
 * import { streamText } from "ai";
 * import { toAISDKTools } from "@copilotkit/runtime/agent/ai-sdk";
 *
 * factory: (ctx) =>
 *   streamText({
 *     model,
 *     system: ctx.learnedSkills.catalog,
 *     messages,
 *     tools: toAISDKTools(ctx.learnedSkills.tools),
 *   }),
 * ```
 *
 * @param tools - TanStack server or client tools, as plain objects or from
 * `toolDefinition()`.
 * @throws Error when a Standard Schema cannot describe itself as JSON Schema.
 */
export function toAISDKTools(tools: readonly AnyTool[]) {
  const result: ToolSet = {};

  for (const tanstackTool of tools) {
    const { execute } = tanstackTool;
    result[tanstackTool.name] = createVercelAISDKTool({
      description: tanstackTool.description,
      inputSchema: toolInputSchema(tanstackTool.name, tanstackTool.inputSchema),
      ...(execute ? { execute: (input: unknown) => execute(input) } : {}),
      ...(tanstackTool.needsApproval ? { needsApproval: true } : {}),
    });
  }

  return result;
}

/**
 * Converts tools made with `defineTool()` to an AI SDK `ToolSet`, for
 * `streamText` calls in a `type: "aisdk"` factory.
 *
 * Each tool offers its JSON Schema to the model. Its `execute` validates the
 * arguments with the tool's parameters schema and runs your `execute` with the
 * parsed output. A tool without `execute` (an interrupt tool) stays
 * client-side.
 *
 * @param tools - Tools from `defineTool()`.
 *
 * ```ts
 * streamText({ model, tools: convertToolDefinitionsToVercelAITools([weatherTool]) })
 * ```
 */
export function convertToolDefinitionsToVercelAITools(
  tools: readonly ToolDefinition[],
) {
  return toAISDKTools(tools);
}
