/**
 * This is the main entry point for the agent.
 * It defines the workflow graph, state, tools, nodes and edges.
 */

import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { ToolRunnableConfig } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseMessage, ToolCall } from "@langchain/core/messages";
import {
  AIMessage,
  isAIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import {
  Command,
  END,
  getCurrentTaskInput,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";
import { Annotation } from "@langchain/langgraph";

// Include CopilotKitStateAnnotation so the frontend can attach actions and
// so messages flow through the same channel the SDK expects.
//
// `interceptedToolCalls` + `originalAIMessageId` mirror
// `@copilotkit/sdk-js/langgraph`'s `copilotkitMiddleware.afterModel`
// intercept pattern (see node_modules/@copilotkit/sdk-js/src/langgraph/middleware.ts):
// on a mixed batch (backend tool call + frontend-action call in the same
// AIMessage), we strip the frontend calls out of the AIMessage before
// ToolNode runs (otherwise ToolNode errors on "Tool not found" for the
// frontend action names), stash them here, then restore them onto the
// original AIMessage before the graph ends so the frontend runtime still
// dispatches them. Raw-StateGraph starters like this one don't use
// createAgent+middleware, so we reproduce the pattern inline.
const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  proverbs: Annotation<string[]>,
  interceptedToolCalls: Annotation<ToolCall[] | undefined>,
  originalAIMessageId: Annotation<string | undefined>,
});

export type AgentState = typeof AgentStateAnnotation.State;

// The renderer in apps/web/src/app/page.tsx validates the *emitted* interrupt
// payload against its own `parseInterruptPayload` shape. We validate the
// *resumed* payload here so an out-of-band Client that resumes with the wrong
// shape fails loudly at the tool boundary instead of silently branching to
// "cancelled".
const ApprovalResumeSchema = z.object({
  approved: z.boolean(),
});

const getWeather = tool(
  (args) => {
    return `The weather for ${args.location} is 70 degrees, clear skies, 45% humidity, 5 mph wind, and feels like 72 degrees.`;
  },
  {
    name: "getWeather",
    description: "Get the weather for a given location.",
    schema: z.object({
      location: z.string().describe("The location to get weather for"),
    }),
  },
);

// HITL tool: triggers an interrupt that the frontend resolves with
// `{ approved: boolean }`. Validated with zod so a malformed resume value
// surfaces as a deterministic tool message rather than throwing through
// ToolNode.
//
// On approval, returns a `Command` that BOTH emits a ToolMessage (so the
// model sees the tool result) AND applies a state update that removes the
// matching proverb from `state.proverbs`. Without the state update, the
// UI (which reads `state.proverbs` via CopilotKit) would still show the
// "deleted" proverb, making the HITL demo a sham.
const deleteProverb = tool(
  async (args, config: ToolRunnableConfig) => {
    // `config.toolCall.id` is the canonical id accessor when a tool is
    // invoked by ToolNode. ToolNode calls `tool.invoke({...call, type:
    // "tool_call"}, config)` (see
    // node_modules/@langchain/langgraph/dist/prebuilt/tool_node.js runTool),
    // and @langchain/core's StructuredTool.invoke then copies the call
    // onto `enrichedConfig.toolCall` (see
    // node_modules/@langchain/core/dist/tools/index.js lines 84-91) before
    // forwarding to the tool function. This is typed on `ToolRunnableConfig`
    // — typing `config` explicitly above is what gives us the safe accessor.
    //
    // We need the id here because returning a `Command` bypasses
    // `_formatToolOutput`'s automatic tool_call_id wiring. If the id is
    // somehow missing we throw loudly rather than silently emitting
    // `tool_call_id: ""`, which OpenAI rejects on the next turn with
    // "tool_call_id does not match any preceding tool_calls".
    const toolCallId = config.toolCall?.id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new Error(
        "deleteProverb: missing tool_call_id on ToolRunnableConfig.toolCall — " +
          "tool was invoked outside a ToolNode context. Refusing to emit a " +
          "ToolMessage with an empty tool_call_id (OpenAI rejects those).",
      );
    }

    const rawApproval = interrupt({
      action: "delete_proverb",
      proverb: args.proverb,
      message: `Are you sure you want to delete the proverb: "${args.proverb}"?`,
    });

    let approval: z.infer<typeof ApprovalResumeSchema>;
    try {
      approval = ApprovalResumeSchema.parse(rawApproval);
    } catch {
      // Don't let ZodError propagate through ToolNode. Return a
      // deterministic tool message so the graph can loop back to chat_node
      // with a readable result in context.
      return new ToolMessage({
        status: "error",
        name: "deleteProverb",
        tool_call_id: toolCallId,
        content:
          "Confirmation failed due to an unexpected resume payload shape; deletion was NOT performed.",
      });
    }

    if (approval.approved) {
      // Read the current graph state via LangGraph's task-local accessor so
      // we can filter `proverbs` deterministically. We match by content
      // (the schema accepts the proverb text). If multiple proverbs tie
      // exactly, only the first matching entry is removed — consistent
      // with "delete the proverb the user named".
      //
      // AgentStateAnnotation's `proverbs` channel has no reducer, so
      // Annotation<string[]> defaults to last-write-wins: emitting a
      // filtered array replaces the channel wholesale (which is exactly
      // what chat_node reads on the next turn for the system prompt).
      const currentState = getCurrentTaskInput<AgentState>();
      const current = Array.isArray(currentState?.proverbs)
        ? currentState.proverbs
        : [];
      const idx = current.indexOf(args.proverb);
      const filtered =
        idx === -1
          ? current
          : [...current.slice(0, idx), ...current.slice(idx + 1)];

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              status: "success",
              name: "deleteProverb",
              tool_call_id: toolCallId,
              content: `Proverb "${args.proverb}" has been deleted.`,
            }),
          ],
          proverbs: filtered,
        },
      });
    }

    return `Deletion of proverb "${args.proverb}" was cancelled by the user.`;
  },
  {
    name: "deleteProverb",
    description:
      "Delete a proverb from the list. This will ask the user for confirmation before deleting.",
    schema: z.object({
      proverb: z.string().describe("The proverb to delete"),
    }),
  },
);

const tools = [getWeather, deleteProverb];

// gpt-4o-mini: reliable tool-calling, low cost. Swap model here if you
// need different tradeoffs.
const MODEL = "gpt-4o-mini";

async function chat_node(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ model: MODEL });

  // Bind tools to the model, including CopilotKit frontend actions.
  //
  // bindTools is optional on BaseChatModel's type; guard explicitly instead
  // of using the non-null `!` escape hatch so a model instance that doesn't
  // support tool binding fails loudly.
  if (typeof model.bindTools !== "function") {
    throw new Error(
      `ChatOpenAI instance for model "${MODEL}" does not expose bindTools; cannot bind tools for this model.`,
    );
  }
  const modelWithTools = model.bindTools([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({
    content: `You are a helpful assistant. The current proverbs are ${JSON.stringify(state.proverbs ?? [])}. If a user asks to delete a proverb, call deleteProverb to trigger a human-in-the-loop interrupt for confirmation.`,
  });

  const response = await modelWithTools.invoke(
    [systemMessage, ...(state.messages ?? [])],
    config,
  );

  return {
    messages: [response],
  };
}

// intercept_frontend_tools: strips frontend-action tool_calls out of the
// last AIMessage before ToolNode runs and stashes them in state.
//
// ToolNode only knows about backend `tools` (getWeather, deleteProverb); it
// looks up each `tool_call.name` in its own registry and throws
// "Tool not found" for any frontend-action name (see
// node_modules/@langchain/langgraph/dist/prebuilt/tool_node.js, runTool).
// On a mixed batch that would leave backend results AND a model-visible
// error ToolMessage for the frontend action, and the frontend would never
// see the frontend-action call at all.
//
// The intercept+restore pattern mirrors CopilotKit's own
// `copilotkitMiddleware.afterModel` + `afterAgent` (see
// node_modules/@copilotkit/sdk-js/src/langgraph/middleware.ts). The
// `restore_frontend_tools` node below reattaches the stashed calls to the
// original AIMessage (matched by id) before the graph ends so the
// CopilotKit runtime still dispatches them to the frontend.
//
// Pure-frontend-only batches skip this node entirely — shouldContinue
// routes them straight to END, and the AIMessage with their tool_calls
// reaches the frontend as-is.
function intercept_frontend_tools(state: AgentState) {
  const frontendActionNames = new Set(
    (state.copilotkit?.actions ?? []).map((a: { name: string }) => a.name),
  );
  if (frontendActionNames.size === 0) {
    return {};
  }

  // Widen to our directly-imported `BaseMessage` type so `isAIMessage`
  // (1.1.27) can narrow a `state.messages[i]` (structurally identical
  // 1.1.40) without the pnpm nominal-mismatch error. Runtime values are
  // unaffected — see the matching annotation on `lastMessage` in
  // `shouldContinue`.
  const messages = (state.messages ?? []) as unknown as BaseMessage[];
  const lastMessage: BaseMessage | undefined = messages[messages.length - 1];
  if (lastMessage === undefined || !isAIMessage(lastMessage)) {
    return {};
  }

  const toolCalls = lastMessage.tool_calls ?? [];
  const backendToolCalls: ToolCall[] = [];
  const frontendToolCalls: ToolCall[] = [];
  for (const call of toolCalls) {
    if (frontendActionNames.has(call.name)) {
      frontendToolCalls.push(call);
    } else {
      backendToolCalls.push(call);
    }
  }

  if (frontendToolCalls.length === 0) {
    // No frontend calls in the batch — nothing to strip.
    return {};
  }

  // Rebuild the AIMessage preserving id (so restore_frontend_tools can
  // find it later) with only the backend calls.
  const strippedAIMessage = new AIMessage({
    content: lastMessage.content,
    tool_calls: backendToolCalls,
    id: lastMessage.id,
  });

  // The outer cast passes the return past a pre-existing pnpm monorepo
  // resolution quirk: `@langchain/langgraph@1.1.5` pins `@langchain/core`
  // at a different patch level than this agent's direct dep, so our
  // imported `AIMessage/BaseMessage` and the graph-state's internal
  // version are nominally distinct types though structurally identical
  // at runtime. chat_node's `return { messages: [response] }` hits the
  // same mismatch implicitly; cf. the baseline tsc errors on that line.
  return {
    messages: [...messages.slice(0, -1), strippedAIMessage],
    interceptedToolCalls: frontendToolCalls,
    originalAIMessageId: lastMessage.id,
  } as unknown as Partial<AgentState>;
}

// restore_frontend_tools: reattaches the stashed frontend-action tool_calls
// to the original AIMessage (matched by id) so the CopilotKit runtime can
// dispatch them to the frontend. Mirrors `copilotkitMiddleware.afterAgent`.
function restore_frontend_tools(state: AgentState) {
  const interceptedToolCalls = state.interceptedToolCalls;
  const originalMessageId = state.originalAIMessageId;
  if (
    !interceptedToolCalls ||
    interceptedToolCalls.length === 0 ||
    !originalMessageId
  ) {
    return {};
  }

  // Widen to our directly-imported `BaseMessage` for `isAIMessage` —
  // see the matching cast in `intercept_frontend_tools` above.
  const messages = (state.messages ?? []) as unknown as BaseMessage[];
  let messageFound = false;
  const updatedMessages: BaseMessage[] = messages.map((msg) => {
    if (isAIMessage(msg) && msg.id === originalMessageId) {
      messageFound = true;
      const existing = msg.tool_calls ?? [];
      return new AIMessage({
        content: msg.content,
        tool_calls: [...existing, ...interceptedToolCalls],
        id: msg.id,
      });
    }
    return msg;
  });

  if (!messageFound) {
    // Don't clear the intercept slot — leaving it set surfaces the drift
    // on the next turn. Tradeoff vs CopilotKit's middleware (which warns
    // and silently returns): we prefer loud over silent here.
    // eslint-disable-next-line no-console
    console.warn(
      `[restore_frontend_tools] original AIMessage id=${originalMessageId} not found in messages; leaving interceptedToolCalls in place for diagnosis`,
    );
    return {};
  }

  // See note on the matching return in `intercept_frontend_tools`.
  return {
    messages: updatedMessages,
    interceptedToolCalls: undefined,
    originalAIMessageId: undefined,
  } as unknown as Partial<AgentState>;
}

// The return type is the union of node names plus END, matching the
// shape addConditionalEdges expects from its callback.
function shouldContinue({
  messages,
  copilotkit,
}: AgentState): "intercept_frontend_tools" | "tool_node" | "restore_frontend_tools" | typeof END {
  // Guard the tool-call-carrying variant structurally instead of casting
  // BaseMessage to AIMessage.
  const lastMessage: BaseMessage | undefined = messages[messages.length - 1];
  if (lastMessage === undefined) {
    return END;
  }
  // AIMessage is the only message variant that carries tool_calls. Use
  // the `isAIMessage` type predicate from @langchain/core/messages so the
  // narrowing is checked rather than cast.
  if (!isAIMessage(lastMessage)) {
    const kind = lastMessage._getType();
    // Log and fall through to END in both dev and prod so a graph-shape
    // bug doesn't crash the process. Tradeoff: the user sees the turn
    // end silently (no synthetic error message surfaced to the chat).
    // Follow-up: emit a synthetic AIMessage from chat_node (not this
    // routing function) the next time we observe unexpected internal
    // state, so the user sees "I hit an unexpected internal state —
    // please try rephrasing."
    // eslint-disable-next-line no-console
    console.warn("[shouldContinue] unexpected last message type:", kind);
    return END;
  }

  // Evaluate ALL tool calls. If ANY tool call targets a backend tool (i.e.
  // not a CopilotKit frontend action), we must route to `tool_node` so the
  // backend tool runs — returning END on mixed batches would silently
  // drop the backend call.
  const toolCalls = lastMessage.tool_calls ?? [];
  if (toolCalls.length > 0) {
    const actionNames = new Set((copilotkit?.actions ?? []).map((a) => a.name));
    // Widen to `Set<string>` because TypeScript's `Set<T>.has` parameter
    // is invariant on T — a `Set<"getWeather" | "deleteProverb">` would
    // reject a caller-supplied plain `string` at compile time even though
    // the runtime answer (`false` for unknown names) is exactly what we
    // want.
    const backendToolNames = new Set<string>(tools.map((t) => t.name));

    let hasBackendTool = false;
    let hasFrontendAction = false;
    for (const toolCall of toolCalls) {
      const name = toolCall.name;
      if (actionNames.has(name)) {
        hasFrontendAction = true;
        // Frontend action — handled client-side.
        continue;
      }
      if (backendToolNames.has(name)) {
        hasBackendTool = true;
        continue;
      }
      // Unknown name: neither a frontend action nor a registered backend
      // tool. Warn here; routing depends on what else is in the batch.
      // - In mixed batches where a known backend tool is ALSO present,
      //   we still return `"tool_node"` below because `hasBackendTool`
      //   is true. ToolNode will emit an error ToolMessage for unknown
      //   tool names; the graph then loops back to chat_node with that
      //   error in context. (We don't strip unknown calls here.)
      // - In batches consisting entirely of unknown calls or only
      //   frontend actions (no backend tool), `hasBackendTool` stays
      //   false and we fall through to END below.
      // Tradeoff: in the pure-unknown case the user sees the turn end
      // silently without a surfaced error. Follow-up: emit a synthetic
      // AIMessage from chat_node on the next turn so the user sees a
      // friendly "I hit an unexpected internal state — please try
      // rephrasing." instead.
      // eslint-disable-next-line no-console
      console.warn(
        `[shouldContinue] unknown tool call name '${name}' — will route to END unless a known backend tool is also present in this batch`,
      );
    }

    // Mixed batch (backend + frontend action): route through the intercept
    // node first so ToolNode doesn't choke on the frontend-action call,
    // then tool_node executes backend calls, then chat_node (looped) will
    // reach END via the restore node.
    if (hasBackendTool && hasFrontendAction) {
      return "intercept_frontend_tools";
    }
    if (hasBackendTool) {
      return "tool_node";
    }
  }

  // Reached END. If we previously intercepted frontend tool calls in a
  // mixed batch, restore them onto the original AIMessage before the
  // CopilotKit runtime serializes messages to the frontend.
  if ((lastMessage.tool_calls ?? []).length === 0) {
    // Only restore when the current turn is an assistant reply (no
    // pending tool_calls) — otherwise we'd mutate a still-in-progress
    // AIMessage. The restore node itself is a no-op when nothing was
    // intercepted, so routing through it is safe either way.
  }

  return "restore_frontend_tools";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chat_node)
  .addNode("tool_node", new ToolNode(tools))
  .addNode("intercept_frontend_tools", intercept_frontend_tools)
  .addNode("restore_frontend_tools", restore_frontend_tools)
  .addEdge(START, "chat_node")
  .addEdge("intercept_frontend_tools", "tool_node")
  .addEdge("tool_node", "chat_node")
  .addEdge("restore_frontend_tools", END)
  .addConditionalEdges("chat_node", shouldContinue);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
