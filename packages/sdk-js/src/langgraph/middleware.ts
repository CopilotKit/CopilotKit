import { createMiddleware, AIMessage, SystemMessage } from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import * as z from "zod";
import { getForwardedHeaders } from "../header-propagation";

type WithJsonSchema<T> = T extends { "~standard": infer S }
  ? Omit<T, "~standard"> & {
      "~standard": S &
        StandardJSONSchemaV1.Props<
          S extends StandardSchemaV1.Props<infer I, any> ? I : unknown,
          S extends StandardSchemaV1.Props<any, infer O> ? O : unknown
        >;
    }
  : T;

/**
 * Augment a Standard-Schema–compatible schema (e.g. Zod) with a
 * `~standard.jsonSchema.input` hook so LangGraph's
 * `getJsonSchemaFromSchema` (called from `StateSchema.getJsonSchema`)
 * can serialize the field.
 *
 * Without this, Zod v4 fields carry `~standard.validate` + `vendor` only,
 * and `isStandardJSONSchema()` returns false, so the field is silently
 * dropped from the graph's `output_schema`. That makes AG-UI
 * `STATE_SNAPSHOT` events filter the field out of the payload sent to
 * the frontend even though the underlying thread state has the value.
 *
 * Use this on any custom state field you want visible to the frontend
 * via `useAgent().state.*`.
 *
 * @example
 * ```ts
 * import { zodState } from "@copilotkit/sdk-js/langgraph";
 *
 * const stateSchema = z.object({
 *   todos: zodState(z.array(TodoSchema).default(() => [])),
 * });
 * ```
 */
export function zodState<T extends object>(schema: T): WithJsonSchema<T> {
  const std = (schema as { "~standard"?: { jsonSchema?: unknown } })[
    "~standard"
  ];
  if (std && typeof std === "object" && !("jsonSchema" in std)) {
    let cached: Record<string, unknown> | undefined;
    std.jsonSchema = {
      input: () => {
        if (cached) return cached;
        // Prefer zod-v4's native `toJSONSchema` when available. Falls back to
        // an empty object, which is sufficient for the field to appear in the
        // graph's output_schema (langgraph-api treats it as an opaque field).
        try {
          const maybeV4ToJsonSchema = (
            z as unknown as {
              toJSONSchema?: (s: unknown) => Record<string, unknown>;
            }
          ).toJSONSchema;
          cached =
            typeof maybeV4ToJsonSchema === "function"
              ? maybeV4ToJsonSchema(schema)
              : {};
        } catch {
          cached = {};
        }
        return cached;
      },
    };
  }
  return schema as WithJsonSchema<T>;
}

/**
 * Internal/framework state keys that should never be auto-surfaced to the
 * LLM as user-facing state. These are reducer-managed message buckets,
 * CopilotKit/AG-UI plumbing, or graph-internal scaffolding.
 */
const RESERVED_STATE_KEYS: ReadonlySet<string> = new Set([
  "messages",
  "copilotkit",
  "ag-ui",
  "tools",
  "structured_response",
  "thread_id",
  "remaining_steps",
]);

/**
 * Controls how user-defined state keys are surfaced into the LLM prompt
 * on every model call. Off by default to avoid leaking arbitrary state
 * into prompts; opt in explicitly.
 *
 * - `false` (default) — never surface state.
 * - `true` — every state key not in the reserved internal set and not
 *   prefixed with `_` is JSON-serialized into a "Current agent state:"
 *   note appended to the system prompt.
 * - `string[]` — only surface the named keys (use this when you want
 *   explicit control over what the LLM sees, e.g. `["liked", "todos"]`).
 */
export type ExposeStateOption = boolean | readonly string[];

const buildStateNote = (
  state: Record<string, unknown>,
  expose: ExposeStateOption,
): string | null => {
  if (expose === false) return null;

  const allow: ReadonlySet<string> | null = Array.isArray(expose)
    ? new Set(expose)
    : null;

  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (
      allow
        ? !allow.has(key)
        : RESERVED_STATE_KEYS.has(key) || key.startsWith("_")
    ) {
      continue;
    }
    const value = state[key];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value as Record<string, unknown>).length === 0)
    ) {
      continue;
    }
    snapshot[key] = value;
  }

  if (Object.keys(snapshot).length === 0) return null;

  let body: string;
  try {
    body = JSON.stringify(snapshot, null, 2);
  } catch {
    body = String(snapshot);
  }
  return `Current agent state:\n${body}`;
};

const applyStateNote = (request: any, expose: ExposeStateOption): any => {
  const note = buildStateNote(
    (request.state ?? {}) as Record<string, unknown>,
    expose,
  );
  if (!note) return request;

  const existing = request.systemPrompt;
  if (existing == null) {
    return { ...request, systemPrompt: new SystemMessage({ content: note }) };
  }
  // existing may be a string OR a SystemMessage
  const baseText =
    typeof existing === "string"
      ? existing
      : typeof existing.content === "string"
        ? existing.content
        : String(existing.content);
  return {
    ...request,
    systemPrompt: new SystemMessage({ content: `${baseText}\n\n${note}` }),
  };
};

const createAppContextBeforeAgent = (state, runtime) => {
  const messages = state.messages;

  if (!messages || messages.length === 0) {
    return;
  }

  // Get app context from runtime
  const appContext = state["copilotkit"]?.context ?? runtime?.context;

  // Check if appContext is missing or empty
  const isEmptyContext =
    !appContext ||
    (typeof appContext === "string" && appContext.trim() === "") ||
    (typeof appContext === "object" && Object.keys(appContext).length === 0);

  if (isEmptyContext) {
    return;
  }

  // Create the context content
  const contextContent =
    typeof appContext === "string"
      ? appContext
      : JSON.stringify(appContext, null, 2);
  const contextMessageContent = `App Context:\n${contextContent}`;
  const contextMessagePrefix = "App Context:\n";

  // Helper to get message content as string
  const getContentString = (msg: any): string | null => {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content) && msg.content[0]?.text)
      return msg.content[0].text;
    return null;
  };

  // Find the first system/developer message (not our context message) to determine
  // where to insert our context message (right after it)
  let firstSystemIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const type = msg._getType?.();
    if (type === "system" || type === "developer") {
      const content = getContentString(msg);
      // Skip if this is our own context message
      if (content?.startsWith(contextMessagePrefix)) {
        continue;
      }
      firstSystemIndex = i;
      break;
    }
  }

  // Check if our context message already exists
  let existingContextIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const type = msg._getType?.();
    if (type === "system" || type === "developer") {
      const content = getContentString(msg);
      if (content?.startsWith(contextMessagePrefix)) {
        existingContextIndex = i;
        break;
      }
    }
  }

  // Create the context message
  const contextMessage = new SystemMessage({ content: contextMessageContent });

  let updatedMessages;

  if (existingContextIndex !== -1) {
    // Replace existing context message
    updatedMessages = [...messages];
    updatedMessages[existingContextIndex] = contextMessage;
  } else {
    // Insert after the first system message, or at position 0 if no system message
    const insertIndex = firstSystemIndex !== -1 ? firstSystemIndex + 1 : 0;
    updatedMessages = [
      ...messages.slice(0, insertIndex),
      contextMessage,
      ...messages.slice(insertIndex),
    ];
  }

  return {
    ...state,
    messages: updatedMessages,
  };
};

/**
 * CopilotKit Middleware for LangGraph agents.
 *
 * Enables:
 * - Dynamic frontend tools from state.tools
 * - Context provided from CopilotKit useCopilotReadable
 *
 * Works with any agent (prebuilt or custom).
 *
 * @example
 * ```typescript
 * import { createAgent } from "langchain";
 * import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";
 *
 * const agent = createAgent({
 *   model: "gpt-4o",
 *   tools: [backendTool],
 *   middleware: [copilotkitMiddleware],
 * });
 * ```
 */
const copilotKitStateSchema = z.object({
  copilotkit: zodState(
    z
      .object({
        actions: z.array(z.any()),
        context: z.any().optional(),
        interceptedToolCalls: z.array(z.any()).optional(),
        originalAIMessageId: z.string().optional(),
      })
      .optional(),
  ),
});

const buildMiddlewareInput = (exposeState: ExposeStateOption) => ({
  name: "CopilotKitMiddleware",

  stateSchema: copilotKitStateSchema as unknown as InteropZodObject,

  // Inject frontend tools, surface user state, and forward x-aimock-* headers
  wrapModelCall: async (request: any, handler: (req: any) => Promise<any>) => {
    request = applyStateNote(request, exposeState);

    // Forward x-aimock-* headers from the incoming AG-UI request
    const forwardedHeaders = getForwardedHeaders();
    if (Object.keys(forwardedHeaders).length > 0) {
      const existingSettings = request.modelSettings ?? {};
      const existingHeaders =
        (existingSettings.headers as Record<string, string>) ?? {};
      request = {
        ...request,
        modelSettings: {
          ...existingSettings,
          headers: { ...existingHeaders, ...forwardedHeaders },
        },
      };
    }

    const frontendTools = request.state["copilotkit"]?.actions ?? [];

    if (frontendTools.length === 0) {
      return handler(request);
    }

    const existingTools = request.tools || [];
    const mergedTools = [...existingTools, ...frontendTools];

    return handler({
      ...request,
      tools: mergedTools,
    });
  },

  beforeAgent: createAppContextBeforeAgent,

  // Restore frontend tool calls to AIMessage before agent exits
  afterAgent: (state) => {
    const interceptedToolCalls = state["copilotkit"]?.interceptedToolCalls;
    const originalMessageId = state["copilotkit"]?.originalAIMessageId;

    if (!interceptedToolCalls?.length || !originalMessageId) {
      return;
    }

    let messageFound = false;
    const updatedMessages = state.messages.map((msg: any) => {
      if (AIMessage.isInstance(msg) && msg.id === originalMessageId) {
        messageFound = true;
        const existingToolCalls = msg.tool_calls || [];
        return new AIMessage({
          content: msg.content,
          tool_calls: [...existingToolCalls, ...interceptedToolCalls],
          id: msg.id,
        });
      }
      return msg;
    });

    // Only clear intercepted state if we successfully restored the tool calls
    if (!messageFound) {
      console.warn(
        `CopilotKit: Could not find message with id ${originalMessageId} to restore tool calls`,
      );
      return;
    }

    return {
      messages: updatedMessages,
      copilotkit: {
        ...state["copilotkit"],
        interceptedToolCalls: undefined,
        originalAIMessageId: undefined,
      },
    };
  },

  // Intercept frontend tool calls after model returns, before ToolNode executes
  afterModel: (state) => {
    const frontendTools = state["copilotkit"]?.actions ?? [];
    if (frontendTools.length === 0) return;

    const frontendToolNames = new Set(
      frontendTools.map((t: any) => t.function?.name || t.name),
    );

    const lastMessage = state.messages[state.messages.length - 1];
    if (!AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
      return;
    }

    const backendToolCalls: any[] = [];
    const frontendToolCalls: any[] = [];

    for (const call of lastMessage.tool_calls) {
      if (frontendToolNames.has(call.name)) {
        frontendToolCalls.push(call);
      } else {
        backendToolCalls.push(call);
      }
    }

    if (frontendToolCalls.length === 0) return;

    const updatedAIMessage = new AIMessage({
      content: lastMessage.content,
      tool_calls: backendToolCalls,
      id: lastMessage.id,
    });

    return {
      messages: [...state.messages.slice(0, -1), updatedAIMessage],
      copilotkit: {
        ...state["copilotkit"],
        interceptedToolCalls: frontendToolCalls,
        originalAIMessageId: lastMessage.id,
      },
    };
  },
});

/**
 * Build a CopilotKit middleware instance with custom options.
 *
 * Use this when you want to override the default state-exposure behavior
 * (for example to hide a sensitive key, or to use an explicit allowlist).
 *
 * @example
 * ```typescript
 * import { createCopilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";
 *
 * const middleware = createCopilotkitMiddleware({
 *   exposeState: ["liked", "todos"],
 * });
 * ```
 */
export const createCopilotkitMiddleware = (
  options: { exposeState?: ExposeStateOption } = {},
) => {
  const exposeState = options.exposeState ?? false;
  return createMiddleware(buildMiddlewareInput(exposeState) as any);
};

/**
 * Default CopilotKit middleware singleton — does NOT surface user state
 * to the LLM. Pass `exposeState: true` (or an allowlist) to
 * {@link createCopilotkitMiddleware} to opt in.
 */
export const copilotkitMiddleware = createCopilotkitMiddleware();
