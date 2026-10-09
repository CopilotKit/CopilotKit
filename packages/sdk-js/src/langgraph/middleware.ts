import { createMiddleware, AIMessage } from "langchain";
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
 * Merge AG-UI defaults with CopilotKit overrides. Dictionaries recurse; every
 * conflicting leaf uses CopilotKit, including false, null and empty values.
 * Arrays and serialized strings are atomic: no positional pairing or decoding.
 */
const isPropertyBag = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const mergeProperties = (
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Array.from(new Set([...Object.keys(base), ...Object.keys(overrides)])).map(
      (key) => {
        const value = Object.prototype.hasOwnProperty.call(overrides, key)
          ? isPropertyBag(base[key]) && isPropertyBag(overrides[key])
            ? mergeProperties(base[key], overrides[key])
            : overrides[key]
          : base[key];
        return [key, value];
      },
    ),
  );

const effectiveProperties = (state: unknown): Record<string, unknown> => {
  const source = isPropertyBag(state) ? state : {};
  return mergeProperties(
    isPropertyBag(source["ag-ui"]) ? source["ag-ui"] : {},
    isPropertyBag(source.copilotkit) ? source.copilotkit : {},
  );
};

const decodeCatalogValue = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * Find the frontend-registered A2UI catalog wherever it was passed. Returns
 * `{ compositionGuide?, catalogId? }` when a catalog is present, else `null`
 * independently of the explicit tool-injection decision. Two
 * delivery paths, depending on how the agent is served:
 *  - AG-UI native endpoint → `state["ag-ui"].a2ui_schema` (JSON
 *    `{ catalogId, components }`); the toolkit reads it from state itself.
 *  - Runtime proxy → an effective `context` entry describing
 *    the A2UI catalog (catalog id + component schemas as text), passed to the
 *    subagent via `compositionGuide`.
 * `catalogId` binds generated surfaces to the frontend's catalog so BYOC
 * custom catalogs render their own components (not the basic one).
 */
const resolveA2uiCatalog = (
  state: any,
): { compositionGuide?: string; catalogId?: string } | null => {
  const properties = effectiveProperties(state);
  const a2uiSchema = properties.a2ui_schema;
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
  const context = decodeCatalogValue(properties.context);
  for (const entry of Array.isArray(context) ? context : []) {
    const description = entry?.description;
    const value = decodeCatalogValue(entry?.value);
    if (
      typeof description !== "string" ||
      typeof value !== "string" ||
      !description.includes("A2UI catalog") ||
      !value
    )
      continue;
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
  effectiveProperties(state).inject_a2ui_tool as boolean | string | undefined;

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

const appendSystemNote = (request: any, note: string): any => {
  const existingMessage = request.systemMessage;
  if (existingMessage != null) {
    const separator = existingMessage.text === "" ? "" : "\n\n";
    return {
      ...request,
      systemMessage: existingMessage.concat(`${separator}${note}`),
    };
  }

  const existing = request.systemPrompt;
  if (existing == null) {
    return { ...request, systemPrompt: note };
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
    systemPrompt: `${baseText}\n\n${note}`,
  };
};

const applyStateNote = (request: any, expose: ExposeStateOption): any => {
  const note = buildStateNote(
    (request.state ?? {}) as Record<string, unknown>,
    expose,
  );
  return note ? appendSystemNote(request, note) : request;
};

const APP_CONTEXT_PREFIX = "App Context:\n";

// LangGraph runtime context carries trusted run configuration (thread, tenant
// and user ids) that must never reach the model, so only a CopilotKit carrier
// inside it counts: an "ag-ui" or "copilotkit" namespace, or a legacy
// unnamespaced carrier with an actions or context key. See #7077.
const runtimeCarrierProperties = (
  carrier: unknown,
  namespace: "ag-ui" | "copilotkit",
): Record<string, unknown> => {
  if (!isPropertyBag(carrier)) return {};
  const nested = carrier[namespace];
  if (isPropertyBag(nested) && Object.keys(nested).length > 0) return nested;
  if (
    namespace === "copilotkit" &&
    ("actions" in carrier || "context" in carrier)
  )
    return carrier;
  return {};
};

const buildAppContextNote = (
  state: unknown,
  runtimeContext: unknown,
): string | null => {
  const stateProperties = effectiveProperties(state);
  const properties = Object.prototype.hasOwnProperty.call(
    stateProperties,
    "context",
  )
    ? stateProperties
    : mergeProperties(
        runtimeCarrierProperties(runtimeContext, "ag-ui"),
        runtimeCarrierProperties(runtimeContext, "copilotkit"),
      );
  const appContext = properties.context;

  const isEmptyContext =
    !appContext ||
    (typeof appContext === "string" && appContext.trim() === "") ||
    (typeof appContext === "object" && Object.keys(appContext).length === 0);
  if (isEmptyContext) return null;

  const contextContent =
    typeof appContext === "string"
      ? appContext
      : JSON.stringify(appContext, null, 2);
  return `${APP_CONTEXT_PREFIX}${contextContent}`;
};

const isAppContextMessage = (msg: any): boolean => {
  const type = msg?._getType?.();
  if (type !== "system" && type !== "developer") return false;
  const content =
    typeof msg.content === "string" ? msg.content : msg.content?.[0]?.text;
  return typeof content === "string" && content.startsWith(APP_CONTEXT_PREFIX);
};

// App context goes into the one leading system message, never a message of its
// own: Anthropic and Gemini reject a second system message. Older releases
// wrote an "App Context:" SystemMessage into the thread, so drop any such
// message from the model's input too.
const applyAppContextNote = (request: any): any => {
  const messages = request.messages ?? [];
  const keptMessages = messages.filter((msg: any) => !isAppContextMessage(msg));
  if (keptMessages.length !== messages.length) {
    request = { ...request, messages: keptMessages };
  }

  const note = buildAppContextNote(request.state, request.runtime?.context);
  return note ? appendSystemNote(request, note) : request;
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
const copilotKitStateSchema = z
  .object({
    "ag-ui": zodState(z.record(z.string(), z.unknown()).optional()),
    copilotkit: zodState(
      z
        .object({
          actions: z
            .union([z.array(z.any()), z.literal(false)])
            .nullable()
            .optional(),
          context: z.any().optional(),
          interceptedToolCalls: z.array(z.any()).optional(),
          originalAIMessageId: z.string().optional(),
        })
        .passthrough()
        .optional(),
    ),
  })
  .passthrough();

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

  // Inject frontend tools, surface user state and app context, and forward
  // x-aimock-* headers
  wrapModelCall: async (request: any, handler: (req: any) => Promise<any>) => {
    request = applyStateNote(request, exposeState);
    request = applyAppContextNote(request);

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
        // ToolNode derives tool runtime state from its config, ignoring an
        // overridden middleware request.state. Adapt the tool's invocation
        // config so the toolkit sees the same effective properties.
        const invoke = candidate.invoke.bind(candidate);
        candidate.invoke = (input, config) => {
          const state =
            config && "state" in config && isPropertyBag(config.state)
              ? config.state
              : request.state;
          const properties = effectiveProperties(state);
          const schema = properties.a2ui_schema;
          const context = decodeCatalogValue(properties.context);
          return invoke(input, {
            ...config,
            state: {
              ...state,
              "ag-ui": {
                ...properties,
                context: Array.isArray(context) ? context : [],
                // The toolkit interpolates the native schema into its prompt.
                a2ui_schema: isPropertyBag(schema)
                  ? JSON.stringify(schema)
                  : schema,
              },
            },
          });
        };
        a2uiTool = candidate;
        a2uiToolsByThread.set(a2uiThreadKey(request.state), a2uiTool);
      }
    }

    const actions = effectiveProperties(request.state).actions;
    let frontendTools = Array.isArray(actions) ? actions : [];
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
    const actions = effectiveProperties(state).actions;
    const frontendTools = Array.isArray(actions) ? actions : [];
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
