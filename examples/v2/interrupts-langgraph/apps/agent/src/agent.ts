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
  Annotation,
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
    } catch (err) {
      // Only swallow ZodError — any other throw (programming errors, runtime
      // failures, etc.) must propagate so we don't mask real bugs behind a
      // generic tool message.
      if (!(err instanceof z.ZodError)) {
        throw err;
      }
      // eslint-disable-next-line no-console
      console.error("[deleteProverb] resume payload rejected:", err.issues);
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

      // Approved-but-not-present: do not lie to the model. Return an
      // error ToolMessage so the model sees "nothing matched" and can
      // respond truthfully instead of confirming a deletion that never
      // happened.
      if (idx === -1) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                status: "error",
                name: "deleteProverb",
                tool_call_id: toolCallId,
                content: `No proverb matching "${args.proverb}" was found; nothing was deleted.`,
              }),
            ],
          },
        });
      }

      const filtered = [...current.slice(0, idx), ...current.slice(idx + 1)];

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

    // Mirror the approved branch: return a Command wrapping a ToolMessage
    // so the model sees a well-formed tool result with the correct
    // tool_call_id (OpenAI rejects tool messages with mismatched ids).
    // Cancellation is not success — the tool did not complete its stated
    // intent — so the ToolMessage status is "error". The content string is
    // truthful as a user-cancelled message.
    return new Command({
      update: {
        messages: [
          new ToolMessage({
            status: "error",
            name: "deleteProverb",
            tool_call_id: toolCallId,
            content: `Deletion of proverb "${args.proverb}" was cancelled by the user.`,
          }),
        ],
      },
    });
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
// Rebuild an AIMessage with a different tool_calls set while preserving
// every other field (additional_kwargs, response_metadata, usage_metadata,
// name, invalid_tool_calls, id, content). Required for LangSmith tracing
// + token accounting — naively constructing `new AIMessage({ content,
// tool_calls, id })` drops everything else.
//
// Note: `tool_call_chunks` only exists on AIMessageChunk, and the AIMessage
// constructor does not accept it — preserving it here was a no-op. Omitted.
function rebuildAIMessageWithToolCalls(
  source: AIMessage,
  toolCalls: ToolCall[],
): AIMessage {
  return new AIMessage({
    content: source.content,
    id: source.id,
    name: source.name,
    additional_kwargs: source.additional_kwargs,
    response_metadata: source.response_metadata,
    usage_metadata: source.usage_metadata,
    invalid_tool_calls: source.invalid_tool_calls,
    tool_calls: toolCalls,
  });
}

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
  let messages = (state.messages ?? []) as unknown as BaseMessage[];

  // The per-turn intercept slot is a single pair (interceptedToolCalls +
  // originalAIMessageId) with no reducer on the annotation — it cannot
  // queue. If the graph re-enters this node for a second mixed batch in
  // the same thread before `restore_frontend_tools` has flushed the prior
  // stash, we must flush the previous stash onto its matching AIMessage
  // inline here. Otherwise last-write-wins would silently drop the
  // earlier frontend-action calls and the frontend would never see them.
  const priorIntercepted = state.interceptedToolCalls;
  const priorOriginalId = state.originalAIMessageId;
  const priorSlotPresent =
    !!priorIntercepted &&
    priorIntercepted.length > 0 &&
    typeof priorOriginalId === "string" &&
    priorOriginalId.length > 0;
  let prior_flushed = false;
  if (priorSlotPresent) {
    messages = messages.map((msg) => {
      if (isAIMessage(msg) && msg.id === priorOriginalId) {
        prior_flushed = true;
        const existing = msg.tool_calls ?? [];
        return rebuildAIMessageWithToolCalls(msg, [
          ...existing,
          ...priorIntercepted!,
        ]);
      }
      return msg;
    });
    if (!prior_flushed) {
      // eslint-disable-next-line no-console
      console.warn(
        `[intercept_frontend_tools] prior intercept slot held id=${priorOriginalId} but no matching AIMessage was found to flush onto; retaining stash for a future intercept pass`,
      );
    }
  }

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
    //
    // Two prior-slot cases to distinguish:
    // (a) prior_flushed === true: we reattached the stashed calls onto
    //     a matching AIMessage above; emit the updated messages and
    //     clear the slot.
    // (b) priorSlotPresent && !prior_flushed: no matching AIMessage was
    //     found THIS pass. This node is non-terminal — leave the slot
    //     UNCHANGED (do not emit interceptedToolCalls / originalAIMessageId
    //     keys) so a future intercept pass can retry the flush. Emitting
    //     `undefined` here would silently drop the stash.
    if (prior_flushed) {
      return {
        messages,
        interceptedToolCalls: undefined,
        originalAIMessageId: undefined,
      } as unknown as Partial<AgentState>;
    }
    return {};
  }

  // Rebuild the AIMessage preserving id (so restore_frontend_tools can
  // find it later) AND all other metadata (additional_kwargs,
  // response_metadata, usage_metadata, etc.) with only the backend calls.
  const strippedAIMessage = rebuildAIMessageWithToolCalls(
    lastMessage,
    backendToolCalls,
  );

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
      // Preserve all AIMessage metadata (additional_kwargs,
      // response_metadata, usage_metadata, name, invalid_tool_calls,
      // tool_call_chunks) — a naive rebuild drops them and breaks
      // LangSmith tracing + token accounting.
      return rebuildAIMessageWithToolCalls(msg, [
        ...existing,
        ...interceptedToolCalls,
      ]);
    }
    return msg;
  });

  if (!messageFound) {
    // This node is terminal (edge goes to END). Clear both slots so a
    // stale stash can't be flushed onto an unrelated AIMessage on a
    // later intercept pass. The warn is the diagnostic signal —
    // persisting the slot would corrupt future turns rather than help
    // diagnose this one.
    // eslint-disable-next-line no-console
    console.warn(
      `[restore_frontend_tools] original AIMessage id=${originalMessageId} not found in messages; clearing stash to avoid cross-turn corruption`,
    );
    return {
      interceptedToolCalls: undefined,
      originalAIMessageId: undefined,
    } as unknown as Partial<AgentState>;
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
}: AgentState):
  | "intercept_frontend_tools"
  | "tool_node"
  | "restore_frontend_tools"
  | "emit_unknown_tools_notice"
  | typeof END {
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
    let hasUnknown = false;
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
      // tool. Track it so we can route unknown-bearing batches through
      // emit_unknown_tools_notice (below), which synthesizes error
      // ToolMessages for each unknown call and strips them off the
      // AIMessage so the frontend runtime never sees them.
      hasUnknown = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[shouldContinue] unknown tool call name '${name}' — will route through emit_unknown_tools_notice unless a known backend tool is also present in this batch`,
      );
    }

    // Mixed batch (backend + frontend action): route through the intercept
    // node first so ToolNode doesn't choke on the frontend-action call,
    // then tool_node executes backend calls, then chat_node (looped) will
    // reach END via the restore node.
    //
    // Note: if the batch also contains unknown calls, we still prefer
    // "tool_node" over the unknown-notice path when a backend call is
    // present — ToolNode itself emits an error ToolMessage for unknown
    // names and the graph loops back to chat_node with that context.
    // The unknown-notice path is reserved for batches that would otherwise
    // end the turn without running tool_node.
    if (hasBackendTool && hasFrontendAction) {
      return "intercept_frontend_tools";
    }
    if (hasBackendTool) {
      return "tool_node";
    }
    // No backend tool. If the batch carries ANY unknown calls (with or
    // without frontend actions), route through emit_unknown_tools_notice
    // so:
    //   (a) error ToolMessages are synthesized for each unknown call,
    //       keeping the AIMessage+ToolMessage sequence well-formed for
    //       OpenAI on the next turn (no dangling tool_calls);
    //   (b) unknown calls are stripped off the AIMessage so the frontend
    //       runtime never sees names it can't dispatch;
    //   (c) in the frontend-action + unknown mixed case, the surviving
    //       frontend-action calls still reach the frontend via the
    //       terminal restore path (emit_unknown_tools_notice goes to END
    //       and the rebuilt AIMessage retains the known frontend calls).
    if (hasUnknown) {
      return "emit_unknown_tools_notice";
    }
  }

  // All paths that reach here are assistant replies with no pending backend tool_calls.
  // Route through restore_frontend_tools; it is a no-op when nothing was intercepted.
  return "restore_frontend_tools";
}

// emit_unknown_tools_notice: when the model emits a tool_calls batch that
// includes names the agent cannot dispatch (neither a registered backend
// tool nor a frontend action), chat_node's conditional edge routes here.
// Responsibilities:
//
//   1. Synthesize an error ToolMessage for EACH unknown tool_call on the
//      prior AIMessage. Without this, the AIMessage's unresolved
//      tool_calls leave a dangling tool-use turn — OpenAI rejects any
//      AIMessage with tool_calls not followed by matching ToolMessages
//      on the NEXT user turn, poisoning the conversation.
//   2. Strip the unknown calls off the prior AIMessage using
//      rebuildAIMessageWithToolCalls, preserving only the known calls
//      (frontend actions). The frontend runtime then receives an
//      AIMessage with only dispatchable names. This is the
//      "strip unknown + emit errors + notice" approach: the mixed
//      frontend-action + unknown batch case is handled by the same
//      code path as the pure-unknown case.
//   3. Append a user-visible AIMessage notice so the turn doesn't end
//      silently when the AIMessage carries only unknown calls.
//
// Conditional edges are pure routing functions — they cannot mutate
// state — so the state rewrite lives here.
function emit_unknown_tools_notice(state: AgentState) {
  const messages = (state.messages ?? []) as unknown as BaseMessage[];
  const lastMessage: BaseMessage | undefined = messages[messages.length - 1];
  if (lastMessage === undefined || !isAIMessage(lastMessage)) {
    return {};
  }

  // Mirror shouldContinue's partition logic so the same known-set defines
  // what counts as unknown. `tools` is the backend registry; the frontend
  // action set comes from state.copilotkit.actions.
  const frontendActionNames = new Set(
    (state.copilotkit?.actions ?? []).map((a: { name: string }) => a.name),
  );
  const backendToolNames = new Set<string>(tools.map((t) => t.name));

  const allCalls = lastMessage.tool_calls ?? [];
  const knownCalls: ToolCall[] = [];
  const unknownCalls: ToolCall[] = [];
  for (const call of allCalls) {
    if (
      frontendActionNames.has(call.name) ||
      backendToolNames.has(call.name)
    ) {
      knownCalls.push(call);
    } else {
      unknownCalls.push(call);
    }
  }

  if (unknownCalls.length === 0) {
    // Nothing unknown to notify about — shouldContinue shouldn't have
    // routed here, but be defensive.
    return {};
  }

  // Rebuild the prior AIMessage with unknown calls stripped, preserving
  // its id + metadata. The error ToolMessages below reference the
  // original tool_call_ids, which OpenAI still matches against the
  // pre-strip call list as long as the ToolMessages follow the
  // AIMessage in sequence.
  const strippedAIMessage = rebuildAIMessageWithToolCalls(
    lastMessage,
    knownCalls,
  );

  const errorToolMessages = unknownCalls.map((call) => {
    const id = call.id;
    if (typeof id !== "string" || id.length === 0) {
      // Defensive: ToolCall.id is optional in the type but OpenAI
      // always emits one in practice. If it's somehow missing, fall
      // back to an empty string — the ToolMessage will be visible to
      // the model but may be rejected on the next turn. Logging here
      // surfaces the anomaly.
      // eslint-disable-next-line no-console
      console.warn(
        `[emit_unknown_tools_notice] unknown tool_call '${call.name}' has no id; emitting ToolMessage with empty tool_call_id`,
      );
    }
    return new ToolMessage({
      status: "error",
      name: call.name,
      tool_call_id: typeof id === "string" ? id : "",
      content: `Tool '${call.name}' is not available in this environment.`,
    });
  });

  const unknownNames = unknownCalls.map((c) => c.name);
  const notice = new AIMessage({
    content: `I tried to call tools that aren't available in this environment (${unknownNames.join(
      ", ",
    )}). Cancelling this turn.`,
  });

  // Sequence on the channel:
  //   [...existing..., strippedAIMessage (replaces lastMessage),
  //    ToolMessage(unknown1), ..., ToolMessage(unknownN),
  //    AIMessage(notice)]
  return {
    messages: [
      ...messages.slice(0, -1),
      strippedAIMessage,
      ...errorToolMessages,
      notice,
    ],
  } as unknown as Partial<AgentState>;
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chat_node)
  .addNode("tool_node", new ToolNode(tools))
  .addNode("intercept_frontend_tools", intercept_frontend_tools)
  .addNode("restore_frontend_tools", restore_frontend_tools)
  .addNode("emit_unknown_tools_notice", emit_unknown_tools_notice)
  .addEdge(START, "chat_node")
  .addEdge("intercept_frontend_tools", "tool_node")
  .addEdge("tool_node", "chat_node")
  .addEdge("restore_frontend_tools", END)
  .addEdge("emit_unknown_tools_notice", END)
  .addConditionalEdges("chat_node", shouldContinue);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
