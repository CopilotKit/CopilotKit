import { createMiddleware, AIMessage, SystemMessage } from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import * as z from "zod";
import { getA2UITools } from "@ag-ui/langgraph";
import type { A2UIToolParams } from "@ag-ui/langgraph";
import { getForwardedHeaders } from "../header-propagation";

// ---------------------------------------------------------------------------
// Auto-A2UI: bridge the inferred model's generate_a2ui tool from wrapModelCall
// (the only hook that exposes the bound model) to wrapToolCall (where the tool
// actually executes but the model is absent). Keyed by the run's thread id so
// concurrent runs don't clobber each other.
// ---------------------------------------------------------------------------
const a2uiToolsByThread = new Map<string, any>();
const A2UI_DEFAULT_THREAD_KEY = "__copilotkit_a2ui_default__";
const a2uiThreadKey = (state: any): string =>
  (state?.thread_id as string) || A2UI_DEFAULT_THREAD_KEY;

/**
 * Find the frontend-registered A2UI catalog wherever it was passed. Returns
 * `{ compositionGuide?, catalogId? }` when a catalog is present, else `null`
 * (so the tool is never advertised when the client can't render A2UI). Two
 * delivery paths, depending on how the agent is served:
 *  - AG-UI native endpoint → `state["ag-ui"].a2ui_schema` (JSON
 *    `{ catalogId, components }`); the toolkit reads it from state itself.
 *  - CopilotKit runtime proxy → a `state.copilotkit.context` entry describing
 *    the A2UI catalog (catalog id + component schemas as text), passed to the
 *    subagent via `compositionGuide`.
 * `catalogId` binds generated surfaces to the frontend's catalog so BYOC
 * custom catalogs render their own components (not the basic one).
 */
const resolveA2uiCatalog = (
  state: any,
): { compositionGuide?: string; catalogId?: string } | null => {
  const a2uiSchema = state?.["ag-ui"]?.a2ui_schema;
  if (a2uiSchema) {
    let catalogId: string | undefined;
    try {
      const parsed =
        typeof a2uiSchema === "string" ? JSON.parse(a2uiSchema) : a2uiSchema;
      catalogId = parsed?.catalogId;
    } catch {
      // non-JSON schema — fall back to the toolkit's basic catalog
    }
    return { catalogId };
  }
  const context = state?.copilotkit?.context;
  for (const entry of Array.isArray(context) ? context : []) {
    const description = entry?.description ?? "";
    const value = entry?.value ?? "";
    if (!description.includes("A2UI catalog") || !value) continue;
    const match = /^\s*-\s+(\S+)/m.exec(value);
    return { compositionGuide: value, catalogId: match?.[1] };
  }
  return null;
};

/**
 * The A2UI `injectA2UITool` decision. The `@ag-ui/a2ui-middleware` forwards it on
 * `forwardedProps`, which `ag-ui-langgraph` surfaces into agent state at
 * `state["ag-ui"].inject_a2ui_tool` — present only when the host turned the
 * runtime A2UI tool on (truthy or a custom tool-name string). `undefined` means
 * no signal (off, or no A2UI middleware in the pipeline) → no auto-injection.
 */
const a2uiInjectDecision = (state: any): boolean | string | undefined =>
  state?.["ag-ui"]?.inject_a2ui_tool;

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

const isToolCallContentBlock = (block: unknown) =>
  typeof block === "object" &&
  block !== null &&
  "type" in block &&
  (block.type === "tool_call" || block.type === "tool_call_chunk");

const usesV1ContentBlocks = (responseMetadata: unknown) =>
  typeof responseMetadata === "object" &&
  responseMetadata !== null &&
  "output_version" in responseMetadata &&
  responseMetadata.output_version === "v1";

/**
 * Rebuilds an AIMessage with `toolCalls` as the source of truth while
 * preserving its non-tool content and metadata. For v1 content blocks, old
 * tool blocks must be removed before construction so they cannot duplicate or
 * override the supplied tool calls when AIMessage synchronizes both fields.
 */
const rebuildAIMessageWithToolCalls = (
  message: AIMessage,
  toolCalls: AIMessage["tool_calls"],
) => {
  let content = message.content;
  if (
    usesV1ContentBlocks(message.response_metadata) &&
    Array.isArray(content)
  ) {
    content = content.filter((block) => !isToolCallContentBlock(block));
  }

  return new AIMessage({
    content,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
    tool_calls: toolCalls,
    invalid_tool_calls: message.invalid_tool_calls,
    usage_metadata: message.usage_metadata,
    id: message.id,
    name: message.name,
  });
};

const buildMiddlewareInput = (
  exposeState: ExposeStateOption,
  a2uiParams?: Omit<A2UIToolParams, "model">,
) => ({
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

    // Opt-in auto-injection of generate_a2ui:
    // (1) only inject when the A2UI injectA2UITool flag is truthy (forwarded by
    //     @ag-ui/a2ui-middleware and surfaced at state["ag-ui"].inject_a2ui_tool);
    // (2) don't double-inject if the agent already defines this tool.
    // The catalog (when present) only binds surfaces to the FE's catalog; it is
    // not the gate. The model is inferred from request.model; the built tool is
    // stashed for wrapToolCall to execute.
    let a2uiTool: any = null;
    const decision = a2uiInjectDecision(request.state);
    if (typeof getA2UITools === "function" && decision) {
      const catalog = resolveA2uiCatalog(request.state);
      // Shared A2UIToolParams: a single params object owned by the toolkit.
      // Start from the host overrides (guidelines / catalog id / tool name /
      // recovery) so a host can steer the subagent, then layer in only what the
      // host cannot know — the bound model, and the registered catalog id +
      // compositionGuide — without clobbering any host-set value.
      const params: A2UIToolParams = {
        ...a2uiParams,
        model: request.model,
      };
      if (catalog?.catalogId && params.defaultCatalogId == null)
        params.defaultCatalogId = catalog.catalogId;
      // Merge the registered catalog schema into any host `guidelines` bag; a
      // host-set compositionGuide wins, host generation/design overrides stay.
      if (catalog?.compositionGuide) {
        const guidelines = { ...params.guidelines };
        if (guidelines.compositionGuide == null)
          guidelines.compositionGuide = catalog.compositionGuide;
        params.guidelines = guidelines;
      }
      const candidate = getA2UITools(params);
      const existingNames = new Set(
        (request.tools || []).map((t: any) => t?.name),
      );
      if (!existingNames.has(candidate.name)) {
        a2uiTool = candidate;
        a2uiToolsByThread.set(a2uiThreadKey(request.state), a2uiTool);
      }
    }

    let frontendTools = request.state["copilotkit"]?.actions ?? [];
    if (a2uiTool) {
      // Our generate_a2ui replaces the runtime's render tool — don't advertise
      // both. Drop the render tool the A2UI middleware injected.
      const drop = typeof decision === "string" ? decision : "render_a2ui";
      frontendTools = frontendTools.filter(
        (t: any) => (t?.function?.name ?? t?.name) !== drop,
      );
    }

    if (frontendTools.length === 0 && !a2uiTool) {
      return handler(request);
    }

    const existingTools = request.tools || [];
    const mergedTools = [
      ...existingTools,
      ...(a2uiTool ? [a2uiTool] : []),
      ...frontendTools,
    ];

    return handler({
      ...request,
      tools: mergedTools,
    });
  },

  // Execute the dynamically-advertised generate_a2ui tool. It is not in the
  // agent's static tool registry, so the tool node cannot run it on its own;
  // we supply the implementation (built with the inferred model) for that one
  // tool. This hook's presence also disables createAgent's "unknown tool"
  // guard for dynamically-advertised tools.
  wrapToolCall: async (request: any, handler: (req: any) => Promise<any>) => {
    const tool = a2uiToolsByThread.get(a2uiThreadKey(request.state));
    if (tool && !request.tool && request.toolCall?.name === tool.name) {
      return handler({ ...request, tool });
    }
    return handler(request);
  },

  beforeAgent: createAppContextBeforeAgent,

  // Restore frontend tool calls to AIMessage before agent exits
  afterAgent: (state) => {
    // Drop the bridged A2UI tool for this run — all tool calls for the turn
    // have executed by now; the next model call re-stashes if needed.
    a2uiToolsByThread.delete(a2uiThreadKey(state));

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
        return rebuildAIMessageWithToolCalls(msg, [
          ...existingToolCalls,
          ...interceptedToolCalls,
        ]);
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

    const updatedAIMessage = rebuildAIMessageWithToolCalls(
      lastMessage,
      backendToolCalls,
    );

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
 * (for example to hide a sensitive key, or to use an explicit allowlist), or
 * to steer the auto-injected `generate_a2ui` subagent via `a2uiParams`.
 *
 * `a2uiParams` is an `A2UIToolParams` without `model` (the middleware always
 * injects the bound model). Use it to override the subagent guidelines
 * (`generationGuidelines` / `designGuidelines` / `compositionGuide`),
 * `defaultCatalogId`, `toolName`, `recovery`, etc. on the auto-inject path —
 * which otherwise only ever uses the toolkit defaults. The registered catalog
 * is still folded in, but host-set values win.
 *
 * @example
 * ```typescript
 * import { createCopilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";
 *
 * const middleware = createCopilotkitMiddleware({
 *   exposeState: ["liked", "todos"],
 *   a2uiParams: { guidelines: { designGuidelines: "...repeating-card layout..." } },
 * });
 * ```
 */
export const createCopilotkitMiddleware = (
  options: {
    exposeState?: ExposeStateOption;
    a2uiParams?: Omit<A2UIToolParams, "model">;
  } = {},
) => {
  const exposeState = options.exposeState ?? false;
  return createMiddleware(
    buildMiddlewareInput(exposeState, options.a2uiParams) as any,
  );
};

/**
 * Default CopilotKit middleware singleton — does NOT surface user state
 * to the LLM. Pass `exposeState: true` (or an allowlist) to
 * {@link createCopilotkitMiddleware} to opt in.
 */
export const copilotkitMiddleware = createCopilotkitMiddleware();
