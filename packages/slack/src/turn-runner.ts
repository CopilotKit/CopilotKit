import { randomUUID } from "node:crypto";
import type { HttpAgent } from "@ag-ui/client";
import type { WebClient } from "@slack/web-api";
import {
  createSlackEventRenderer,
  type CapturedToolCall,
  type SlackEventRendererHandle,
} from "./event-renderer.js";
import type { SlackConversationStore } from "./conversation-store.js";
import {
  parseToolArgs,
  stringifyHandlerResult,
  toAgentToolDescriptors,
  type FrontendTool,
  type FrontendToolContext,
  type SlackContextEntry,
} from "./frontend-tools.js";
import { validateSchema } from "./standard-schema.js";
import {
  applyRenderResult,
  HITL_PICKER_EVENT_TYPE,
  INTERRUPT_PICKER_EVENT_TYPE,
  injectResumeValues,
  type HitlRenderApi,
  type HumanInTheLoop,
  type HumanInTheLoopRegistry,
} from "./human-in-the-loop.js";
import type { InterruptHandler } from "./interrupt.js";
import type { ActivityMessageRenderer } from "./activity-message-renderer.js";
import type { ConversationKey, IncomingTurn, ReplyTarget } from "./types.js";
import { DM_SCOPE } from "./types.js";

export interface TurnRunnerConfig {
  store: SlackConversationStore;
  /** Factory that returns a fresh per-conversation HttpAgent. */
  makeAgent: (threadId: string) => HttpAgent;
  /** Frontend tools the agent can call against Slack. */
  tools?: ReadonlyArray<FrontendTool>;
  /** Readonly context entries forwarded on every `runAgent` call. */
  context?: ReadonlyArray<SlackContextEntry>;
  /** The bridge's bot user id — passed into tool contexts. */
  botUserId?: string;
  /** Hard cap on iterations of the frontend-tool execution loop. */
  maxToolIterations?: number;
  /**
   * Human-in-the-loop wait registry. Optional — when set, the runner
   * cancels any in-flight waits for a conversation on interrupt.
   */
  hitlRegistry?: HumanInTheLoopRegistry;
  /**
   * Handlers for LangGraph-style `interrupt()` events. When the agent
   * run finalizes with a captured `on_interrupt` custom event, the
   * runner looks up a handler by event name, renders the Block Kit
   * picker, awaits the user's click, then resumes the graph via
   * `runAgent({forwardedProps: {command: {resume, interruptEvent}}})`.
   */
  interruptHandlers?: ReadonlyArray<InterruptHandler>;
  /**
   * Backend-tool-call status post policy. Forwarded to the renderer.
   * Default: no status rows. See `SlackBridgeConfig.showToolStatus`.
   */
  showToolStatus?: boolean | ReadonlyArray<string>;
  /**
   * Renderers for AG-UI activity messages — forwarded to the event
   * renderer for `onActivitySnapshotEvent` handling. See
   * `SlackBridgeConfig.renderActivityMessages`.
   */
  renderActivityMessages?: ReadonlyArray<ActivityMessageRenderer<any>>;
}

/**
 * Per-conversation record of the currently-running turn. New turns that
 * arrive for the same conversation key abort the prior agent run.
 */
interface InFlightEntry {
  agent: HttpAgent;
  renderer: SlackEventRendererHandle;
  /** Flag flipped to true when this run is being deliberately aborted. */
  aborted: boolean;
  /** Promise that resolves when this run has finished (or aborted). */
  completion: Promise<void>;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 6;

const keyOf = (k: ConversationKey): string => `${k.channelId}::${k.scope}`;

/** Resolved identity of the requester, baked into per-turn context. */
interface SenderProfile {
  id: string;
  name?: string;
  email?: string;
}

// users.info is stable per user for the life of a process; cache it so we
// don't re-fetch the requester's profile on every message.
const senderProfileCache = new Map<string, SenderProfile>();

/**
 * Resolve a Slack user id to a display name + email so the agent can match
 * the requester to their Linear/Notion account. Best-effort: on any error
 * (e.g. missing `users:read.email`) we return just the id, and the agent
 * degrades to id-only.
 */
async function resolveSenderProfile(
  client: WebClient,
  userId: string,
): Promise<SenderProfile> {
  const cached = senderProfileCache.get(userId);
  if (cached) return cached;
  let profile: SenderProfile = { id: userId };
  try {
    const r = (await client.users.info({ user: userId })) as {
      user?: {
        real_name?: string;
        profile?: { real_name?: string; display_name?: string; email?: string };
      };
    };
    const u = r.user;
    profile = {
      id: userId,
      name:
        u?.profile?.display_name ||
        u?.profile?.real_name ||
        u?.real_name ||
        undefined,
      email: u?.profile?.email || undefined,
    };
  } catch (err) {
    console.error("[turn-runner] users.info for sender failed:", err);
  }
  senderProfileCache.set(userId, profile);
  return profile;
}

/**
 * Generate a fresh message id. Standalone fn so tests can monkey-patch
 * via the global (or we can swap to crypto.randomUUID).
 */
const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `msg-${Math.random().toString(36).slice(2, 11)}`;

/**
 * One-turn orchestration.
 *
 *   1. find-or-create the conversation session via the store (which builds
 *      `agent.messages` from Slack's stored thread/DM history),
 *   2. set up the Slack renderer for this reply target,
 *   3. call `agent.runAgent`. When the agent emits frontend-tool calls
 *      (e.g. `lookup_slack_user`), execute them locally, push the tool
 *      results into `agent.messages`, and re-invoke until the agent
 *      stops calling frontend tools.
 *   4. errors surface as a `:warning:` in the conversation — unless the
 *      run was intentionally aborted (in which case the renderer already
 *      marked the partial reply as interrupted).
 *
 * Interrupt semantics: if a new turn arrives for the same conversation
 * while the previous one is still streaming, we cancel the prior run via
 * `agent.abortRun()`, mark its partial reply with `_(interrupted)_`,
 * await its full settlement, then proceed.
 */
export function createTurnRunner(config: TurnRunnerConfig) {
  // Closure-scoped map — one bridge process owns one runTurn closure.
  const inFlight = new Map<string, InFlightEntry>();
  const tools = config.tools ?? [];
  const toolRegistry = new Map<string, FrontendTool>(
    tools.map((t) => [t.name, t]),
  );
  const frontendToolNames = new Set(toolRegistry.keys());
  const toolDescriptors = toAgentToolDescriptors(tools);
  const contextEntries: SlackContextEntry[] = (config.context ?? []).map(
    (c) => ({
      description: c.description,
      value: c.value,
    }),
  );
  const maxIters = config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const interruptHandlers = config.interruptHandlers ?? [];
  const interruptEventNames = new Set<string>(
    interruptHandlers.map((h) => h.eventName ?? "on_interrupt"),
  );

  return async function runTurn(
    turn: IncomingTurn,
    client: WebClient,
  ): Promise<void> {
    const key = keyOf(turn.conversation);

    // ── Interrupt any in-flight run for this conversation ────────────
    const prev = inFlight.get(key);
    if (prev) {
      prev.aborted = true;
      try {
        prev.agent.abortRun();
      } catch (err) {
        console.error("[turn-runner] abortRun threw:", err);
      }
      // Cancel any human-in-the-loop waits this conversation has open —
      // otherwise an interactive component the previous turn was waiting
      // on would dangle.
      config.hitlRegistry?.cancelConversation(key);
      await prev.renderer.markInterrupted().catch((err) => {
        console.error("[turn-runner] markInterrupted threw:", err);
      });
      await prev.completion.catch(() => {
        /* aborts surface as rejections; we already marked them */
      });
    }

    // ── Build the new session and renderer ──────────────────────────
    const session = await config.store.getOrCreate(
      turn.conversation,
      turn.replyTarget,
      config.makeAgent,
    );
    const renderer = createSlackEventRenderer({
      client,
      target: turn.replyTarget,
      frontendToolNames,
      interruptEventNames,
      showToolStatus: config.showToolStatus,
      renderActivityMessages: config.renderActivityMessages,
    });

    const entry: InFlightEntry = {
      agent: session.agent,
      renderer,
      aborted: false,
      completion: undefined as unknown as Promise<void>,
    };

    // Per-turn context: tell the agent who sent this message so it can act
    // on their behalf ("my issues", assign-to-me, etc.). We resolve the
    // sender's name + email here (rather than making the agent look it up)
    // so the requester identity is unambiguous and always present.
    const sender = turn.senderUserId
      ? await resolveSenderProfile(client, turn.senderUserId)
      : undefined;
    const turnContext = sender
      ? [
          {
            description: "Requesting Slack user",
            value:
              `This message was sent by ${
                sender.name ? `${sender.name} ` : ""
              }<@${sender.id}>${
                sender.email ? ` (email: ${sender.email})` : ""
              }. When the user says "me", "my", "mine", or "I", they mean this ` +
              `person. Use their email/name to match them to their Linear/Notion ` +
              `account: scope "my issues" to them (filter Linear by this ` +
              `assignee), and assign issues you create on their behalf to them.`,
          },
          ...contextEntries,
        ]
      : contextEntries;

    entry.completion = (async () => {
      try {
        await runWithToolLoop({
          agent: session.agent,
          renderer,
          tools: toolRegistry,
          toolDescriptors,
          context: turnContext,
          maxIters,
          toolCtx: {
            client,
            channel: turn.replyTarget.channel,
            threadTs: turn.replyTarget.threadTs,
            botUserId: config.botUserId ?? "",
            conversationKey: key,
            senderUserId: turn.senderUserId,
            postFile: async ({ bytes, filename, title, altText }) => {
              try {
                // Build args without undefined fields (uploadV2's types
                // reject `undefined` for optional props).
                const uploadArgs: Record<string, unknown> = {
                  channel_id: turn.replyTarget.channel,
                  file: Buffer.from(bytes),
                  filename,
                };
                if (turn.replyTarget.threadTs)
                  uploadArgs["thread_ts"] = turn.replyTarget.threadTs;
                if (title) uploadArgs["title"] = title;
                if (altText) uploadArgs["alt_text"] = altText;
                const res = (await client.files.uploadV2(
                  uploadArgs as unknown as Parameters<
                    typeof client.files.uploadV2
                  >[0],
                )) as { files?: Array<{ id?: string }> };
                return { ok: true, fileId: res.files?.[0]?.id };
              } catch (err) {
                console.error("[turn-runner] postFile failed:", err);
                return { ok: false, error: (err as Error).message };
              }
            },
          },
          isAborted: () => entry.aborted,
          interruptHandlers,
          hitlRegistry: config.hitlRegistry,
          replyTarget: turn.replyTarget,
          client,
        });
      } catch (err) {
        if (entry.aborted) return; // interrupt path; no warning
        console.error("[turn-runner] agent run failed:", err);
        try {
          await client.chat.postMessage({
            channel: turn.replyTarget.channel,
            thread_ts: turn.replyTarget.threadTs,
            text: `:warning: Bridge error: ${(err as Error).message}`,
          });
        } catch {
          // best-effort
        }
      } finally {
        if (inFlight.get(key) === entry) inFlight.delete(key);
      }
    })();

    inFlight.set(key, entry);
  };
}

/**
 * Recover from a click on an interrupt **or** HITL picker whose
 * in-process pending wait is gone (almost always: the bridge restarted
 * between picker-post and click). Slack is the source of truth for the
 * dispatch context.
 *
 * The recovery does two things in sequence:
 *
 *   1. Fetch the picker via `conversations.replies(include_all_metadata)`,
 *      parse its `metadata.event_payload` to recover handler name +
 *      originating context. Render the resolved state and apply via
 *      the click's `response_url` (`replace_original`) — so the picker
 *      is replaced by the same confirmation it would have shown if the
 *      bridge had never restarted.
 *
 *   2. **Interrupts only**: thaw the paused LangGraph graph by firing
 *      `runAgent({forwardedProps:{command:{resume}}})` — the agent's
 *      natural-language reply lands as a new bot message.
 *
 *      **HITL recovery skips step 2** because the LangGraph thread is
 *      already finished (CopilotKit middleware's `after_model` removes
 *      the frontend tool call from the AIMessage, `after_agent`
 *      restores it, and the graph reaches `RUN_FINISHED`). There's no
 *      paused state to thaw. The resolved picker (step 1) is itself a
 *      bot message in the thread; the conversation-store will fold it
 *      into the assistant turn on the next user message, giving the
 *      agent context on the chosen value.
 *
 * If the metadata is missing (picker posted by an older bridge version)
 * or the handler isn't registered any more, step 1 is skipped. Step 2
 * proceeds for interrupts (we still have the resume value).
 */
export async function recoverFromStaleClick(args: {
  conversation: ConversationKey;
  replyTarget: ReplyTarget;
  resumeValue: unknown;
  click: { responseUrl?: string; messageTs?: string };
  interruptHandlers: ReadonlyArray<InterruptHandler>;
  humanInTheLoopComponents: ReadonlyArray<HumanInTheLoop>;
  hitlRegistry: HumanInTheLoopRegistry;
  client: WebClient;
  makeAgent: (threadId: string) => HttpAgent;
  botUserId: string;
}): Promise<void> {
  const {
    conversation,
    replyTarget,
    resumeValue,
    click,
    interruptHandlers,
    humanInTheLoopComponents,
    hitlRegistry,
    client,
    makeAgent,
    botUserId,
  } = args;

  // ── 1. Resolved render — replace picker in place ──────────────────
  let pickerEventType: string | undefined;
  let resumedThreadId: string | undefined;
  if (click.messageTs) {
    try {
      const resolved = await renderResolvedFromMetadata({
        client,
        channel: replyTarget.channel,
        threadTs: replyTarget.threadTs,
        messageTs: click.messageTs,
        responseUrl: click.responseUrl,
        resumeValue,
        interruptHandlers,
        humanInTheLoopComponents,
        hitlRegistry,
        botUserId,
        conversationKey: keyOf(conversation),
      });
      pickerEventType = resolved?.eventType;
      resumedThreadId = resolved?.threadId;
    } catch (err) {
      console.error("[turn-runner] stale-click resolved render failed:", err);
    }
  }

  // ── 2. Thaw the graph (interrupts only — HITL graph is already finished) ─
  if (pickerEventType === HITL_PICKER_EVENT_TYPE) {
    // For HITL the LangGraph thread is already in RUN_FINISHED. The
    // resolved picker reflects the user's choice in Slack; the next
    // user message will pick up the context naturally.
    return;
  }
  // Resume on the exact thread the interrupt paused on. Threads are unique
  // per turn (see SlackConversationStore.newThreadId), so the paused thread
  // is whatever the picker recorded in its metadata. Fall back to the
  // legacy stable id for pickers posted by an older bridge build that
  // didn't persist one.
  const agent = makeAgent(
    `slack-${conversation.channelId}-${conversation.scope}`,
  );
  if (resumedThreadId) {
    agent.threadId = resumedThreadId;
  } else {
    // No threadId in the picker metadata — almost certainly a picker posted
    // by a bridge build from before per-turn threads existed. The stable id
    // we fall back to no longer matches any thread the runtime created, so
    // the resume may no-op; surface it rather than letting the click look
    // like it silently did nothing.
    console.warn(
      "[turn-runner] stale-click resume has no threadId in picker metadata; " +
        "falling back to the legacy stable thread id (likely a pre-upgrade picker)",
    );
  }
  const renderer = createSlackEventRenderer({ client, target: replyTarget });
  try {
    await agent.runAgent(
      { forwardedProps: { command: { resume: resumeValue } } },
      renderer.subscriber,
    );
  } catch (err) {
    console.error("[turn-runner] stale-click resume failed:", err);
    try {
      await client.chat.postMessage({
        channel: replyTarget.channel,
        thread_ts: replyTarget.threadTs,
        text: `:warning: Failed to resume from button click: ${(err as Error).message}`,
      });
    } catch {
      // best-effort
    }
  }
}

/** Back-compat alias — older callers used the interrupt-specific name. */
export const recoverInterruptFromStaleClick = recoverFromStaleClick;

/**
 * Dispatch an A2UI button click back to the agent.
 *
 * Counterpart to `recoverFromStaleClick` for the interrupt/HITL flows.
 * The decoded `userAction` (matching `@ag-ui/a2ui-middleware`'s
 * `A2UIUserAction` shape) gets forwarded on `forwardedProps.a2uiAction`;
 * the A2UI middleware on the agent side picks it up via
 * `processUserAction` and synthesizes a tool-result message that the
 * graph sees on its next turn. The agent then responds (e.g. confirming
 * "Booked your flight…"), which streams back into the same conversation
 * just like any other turn.
 *
 * No picker-replacement step here (unlike interrupt-resume): A2UI
 * surfaces stay live so the user can click again. Confirmation text
 * comes via the agent's reply.
 */
export async function dispatchA2UIAction(args: {
  conversation: ConversationKey;
  replyTarget: ReplyTarget;
  userAction: Record<string, unknown>;
  renderActivityMessages: ReadonlyArray<
    import("./activity-message-renderer.js").ActivityMessageRenderer<any>
  >;
  client: WebClient;
  makeAgent: (threadId: string) => HttpAgent;
}): Promise<void> {
  const {
    conversation,
    replyTarget,
    userAction,
    renderActivityMessages,
    client,
    makeAgent,
  } = args;

  // Fresh thread per click, matching the per-turn isolation in
  // SlackConversationStore.newThreadId. The A2UI dispatch is self-contained
  // — it forwards the decoded `userAction` (which carries its own
  // surfaceId/sourceComponentId/context) for the middleware to turn into a
  // synthesized tool-result — so it does not need the surface's originating
  // thread. Reusing a stable id would instead let the server-side thread
  // accumulate across clicks and re-introduce the "Message not found"
  // balloon this package otherwise avoids.
  const threadId = `slack-${conversation.channelId}-${conversation.scope}-${randomUUID()}`;
  const agent = makeAgent(threadId);
  const renderer = createSlackEventRenderer({
    client,
    target: replyTarget,
    renderActivityMessages,
  });
  try {
    await agent.runAgent(
      { forwardedProps: { a2uiAction: { userAction } } },
      renderer.subscriber,
    );
  } catch (err) {
    console.error("[turn-runner] a2ui-action dispatch failed:", err);
    try {
      await client.chat.postMessage({
        channel: replyTarget.channel,
        thread_ts: replyTarget.threadTs,
        text: `:warning: Failed to dispatch button click: ${(err as Error).message}`,
      });
    } catch {
      // best-effort
    }
  }
}

/**
 * Fetch the picker, read its metadata, look up the matching handler
 * (interrupt or HITL based on `event_type`), and replace the picker
 * with the resolved render result. Returns silently if any step lacks
 * the info needed.
 */
async function renderResolvedFromMetadata(args: {
  client: WebClient;
  channel: string;
  threadTs?: string;
  messageTs: string;
  responseUrl?: string;
  resumeValue: unknown;
  interruptHandlers: ReadonlyArray<InterruptHandler>;
  humanInTheLoopComponents: ReadonlyArray<HumanInTheLoop>;
  hitlRegistry: HumanInTheLoopRegistry;
  botUserId: string;
  conversationKey: string;
}): Promise<{ eventType?: string; threadId?: string } | undefined> {
  const r = (await args.client.conversations.replies({
    channel: args.channel,
    ts: args.messageTs,
    limit: 1,
    inclusive: true,
    include_all_metadata: true,
  } as never)) as {
    messages?: Array<{
      ts?: string;
      metadata?: {
        event_type?: string;
        event_payload?: Record<string, unknown>;
      };
    }>;
  };
  const picker = r.messages?.[0];
  if (!picker?.metadata?.event_payload) return;
  const evType = picker.metadata.event_type;
  const meta = picker.metadata.event_payload;
  const pickerThreadId = (meta as { threadId?: string }).threadId;

  let resolvedRender: ReturnType<HumanInTheLoop["render"]> | undefined;
  let text = "";
  const sharedApi: HitlRenderApi = {
    respond() {
      return args.hitlRegistry.mintActionId();
    },
  };

  if (evType === INTERRUPT_PICKER_EVENT_TYPE) {
    const handlerName = (meta as { handler?: string }).handler;
    if (!handlerName) return;
    const handler = args.interruptHandlers.find((h) => h.name === handlerName);
    if (!handler) return;
    const parsed = await validateSchema(
      handler.payload,
      (meta as { payload?: unknown }).payload,
    );
    if (!parsed.ok) {
      console.warn(
        "[turn-runner] interrupt resolve payload failed validation:",
        parsed.error,
      );
      return;
    }
    try {
      resolvedRender = handler.render(
        {
          status: "resolved",
          payload: parsed.value,
          value: args.resumeValue,
        } as never,
        sharedApi,
      );
    } catch (err) {
      console.error(
        "[turn-runner] interrupt handler.render(resolved) threw:",
        err,
      );
      return;
    }
    text = handler.fallbackText
      ? handler.fallbackText(parsed.value)
      : handler.description;
  } else if (evType === HITL_PICKER_EVENT_TYPE) {
    const handlerName = (meta as { handler?: string }).handler;
    if (!handlerName) return;
    const component = args.humanInTheLoopComponents.find(
      (c) => c.name === handlerName,
    );
    if (!component) return;
    const parsedProps = await validateSchema(
      component.props,
      (meta as { props?: unknown }).props,
    );
    if (!parsedProps.ok) {
      console.warn(
        "[turn-runner] HITL resolve props failed validation:",
        parsedProps.error,
      );
      return;
    }
    try {
      resolvedRender = component.render(
        {
          status: "resolved",
          props: parsedProps.value,
          value: args.resumeValue,
        } as never,
        sharedApi,
      );
    } catch (err) {
      console.error(
        "[turn-runner] HITL component.render(resolved) threw:",
        err,
      );
      return;
    }
    text = component.fallbackText
      ? component.fallbackText(parsedProps.value)
      : component.description;
  } else {
    // Unknown picker type — leave it alone.
    return;
  }

  await applyRenderResult({
    result: resolvedRender,
    text,
    ctx: {
      client: args.client,
      channel: args.channel,
      threadTs: args.threadTs,
      botUserId: args.botUserId,
      conversationKey: args.conversationKey,
    },
    click: args.responseUrl ? { responseUrl: args.responseUrl } : undefined,
    existingMessageTs: args.messageTs,
  });
  return { eventType: evType, threadId: pickerThreadId };
}

/**
 * Helper: derive `ConversationKey` + `ReplyTarget` from a Slack
 * `block_actions` click payload. The picker that fired the click lives
 * either in a thread (channel + thread_ts) or in a DM (channel only).
 */
export function clickToConversation(args: {
  channelId: string;
  /** thread_ts the picker lives in, or undefined for DMs */
  threadTs?: string;
  /** Slack channel type; `"im"` means DM. */
  channelType?: string;
}): { conversation: ConversationKey; replyTarget: ReplyTarget } {
  const isDM = args.channelType === "im";
  const scope = isDM ? DM_SCOPE : (args.threadTs ?? "");
  return {
    conversation: { channelId: args.channelId, scope },
    replyTarget: {
      channel: args.channelId,
      threadTs: isDM ? undefined : args.threadTs,
    },
  };
}

/**
 * Run the agent, executing any frontend-tool calls and re-invoking until
 * the agent stops calling them (or we hit the iteration cap).
 */
async function runWithToolLoop(args: {
  agent: HttpAgent;
  renderer: SlackEventRendererHandle;
  tools: Map<string, FrontendTool>;
  toolDescriptors: ReturnType<typeof toAgentToolDescriptors>;
  context: ReadonlyArray<SlackContextEntry>;
  toolCtx: FrontendToolContext;
  maxIters: number;
  isAborted: () => boolean;
  interruptHandlers: ReadonlyArray<InterruptHandler>;
  hitlRegistry?: HumanInTheLoopRegistry;
  replyTarget: { channel: string; threadTs?: string };
  client: WebClient;
}): Promise<void> {
  const {
    agent,
    renderer,
    tools,
    toolDescriptors,
    context,
    toolCtx,
    maxIters,
    isAborted,
    interruptHandlers,
    hitlRegistry,
    replyTarget,
    client,
  } = args;
  const executedIds = new Set<string>();
  /**
   * If the previous iteration consumed an interrupt and the user picked
   * a resolution, we resume the graph with `forwardedProps.command.resume`
   * on the next iteration instead of starting a fresh run. The
   * `interruptEvent` field is included for parity with the React
   * `useHeadlessInterrupt` contract (the backend ignores it; the React
   * frontend uses it as a snapshot for debugging).
   */
  let resumeCommand: { resume: unknown; interruptEvent: unknown } | undefined;

  for (let i = 0; i < maxIters; i++) {
    if (resumeCommand) {
      await agent.runAgent(
        { forwardedProps: { command: resumeCommand } },
        renderer.subscriber,
      );
      resumeCommand = undefined;
    } else {
      await agent.runAgent(
        { tools: toolDescriptors, context: [...context] },
        renderer.subscriber,
      );
    }
    if (isAborted()) return;

    // ── 1. LangGraph interrupt? render Block Kit and await action ────
    const pending = renderer.getPendingInterrupt();
    if (pending) {
      renderer.clearPendingInterrupt();
      const handler = interruptHandlers.find(
        (h) => (h.eventName ?? "on_interrupt") === pending.eventName,
      );
      if (!handler) {
        console.warn(
          "[turn-runner] no interrupt handler registered for event '%s' — graph will stay paused",
          pending.eventName,
        );
        return;
      }
      if (!hitlRegistry) {
        console.warn(
          "[turn-runner] interrupt fired but no HumanInTheLoopRegistry available — graph will stay paused",
        );
        return;
      }
      const parsed = await validateSchema(handler.payload, pending.value);
      if (!parsed.ok) {
        console.warn(
          "[turn-runner] interrupt payload failed validation:",
          parsed.error,
        );
        return;
      }

      const text = handler.fallbackText
        ? handler.fallbackText(parsed.value)
        : handler.description;

      // ── 1a. Initial render (pending state) ────────────────────────
      const pendingActionMap = new Map<string, unknown>();
      const pendingResult = handler.render(
        { status: "pending", payload: parsed.value } as never,
        {
          respond(value: unknown) {
            const id = hitlRegistry.mintActionId();
            pendingActionMap.set(id, value);
            return id;
          },
        },
      );
      if (pendingResult === "noop" || pendingResult === "delete") {
        console.warn(
          "[turn-runner] interrupt render({status:'pending'}) must return KnownBlock[]; graph paused",
        );
        return;
      }
      // Inject resume values into the buttons so a bridge restart between
      // picker-post and click can still recover via the bridge's
      // recoverInterruptFromStaleClick path.
      const encodedPending = injectResumeValues(
        pendingResult,
        pendingActionMap,
      );
      let messageTs: string | undefined;
      try {
        const r = await applyRenderResult({
          result: encodedPending,
          text,
          ctx: toolCtx,
          // Attach the handler name + the agent's interrupt payload to
          // the message so a stale click after restart can rehydrate
          // both render-resolved AND resume contexts purely from Slack.
          metadata: {
            event_type: INTERRUPT_PICKER_EVENT_TYPE,
            event_payload: {
              handler: handler.name,
              payload: parsed.value,
              // The turn's LangGraph threadId. Threads are now unique per
              // turn (see SlackConversationStore.newThreadId), so a stale
              // click after a bridge restart can only resume the *paused*
              // thread if we persist it here — re-deriving a stable id
              // would target a thread that never existed.
              threadId: agent.threadId,
            },
          },
        });
        messageTs = r.messageTs;
      } catch (err) {
        console.error("[turn-runner] interrupt initial render failed:", err);
        return;
      }

      // ── 1b. Await user action ─────────────────────────────────────
      const { result, click } = await hitlRegistry.startWaiting({
        conversationKey: toolCtx.conversationKey,
        actionMap: pendingActionMap,
      });

      // ── 1c. Resolution render ─────────────────────────────────────
      const resolvedState =
        result.kind === "resolved"
          ? {
              status: "resolved" as const,
              payload: parsed.value,
              value: result.value,
            }
          : { status: result.kind, payload: parsed.value };
      let resolvedRender;
      try {
        resolvedRender = handler.render(resolvedState as never, {
          respond() {
            // Follow-up responses on the resolved render aren't wired
            // for interrupts yet — same as HITL v1.
            return hitlRegistry.mintActionId();
          },
        });
      } catch (err) {
        console.error("[turn-runner] interrupt resolved render threw:", err);
        resolvedRender = "noop" as const;
      }
      try {
        await applyRenderResult({
          result: resolvedRender,
          text,
          ctx: toolCtx,
          click,
          existingMessageTs: messageTs,
        });
      } catch (err) {
        console.error(
          "[turn-runner] applying interrupt resolved render failed:",
          err,
        );
      }

      if (result.kind !== "resolved") return; // cancelled or timed out
      resumeCommand = {
        resume: result.value,
        interruptEvent: { name: pending.eventName, value: pending.value },
      };
      continue;
    }

    // ── 2. Frontend-tool calls? execute and push results ─────────────
    const calls = renderer
      .getCapturedToolCalls()
      .filter(
        (c) => tools.has(c.toolCallName) && !executedIds.has(c.toolCallId),
      );
    if (calls.length === 0) return;

    // Make sure the agent's message history contains the assistant message
    // with these tool calls (so the next run sees a coherent transcript)
    // and the tool result messages we're about to push.
    ensureAssistantToolCallMessage(agent, calls);

    for (const call of calls) {
      const tool = tools.get(call.toolCallName)!;
      const parsed = await parseToolArgs(tool.parameters, call.toolCallArgs);
      let result: string;
      if (!parsed.ok) {
        result = JSON.stringify({
          error: `invalid arguments: ${parsed.error}`,
        });
      } else {
        try {
          const raw = await tool.handler(parsed.value, toolCtx);
          result = stringifyHandlerResult(raw);
        } catch (err) {
          result = JSON.stringify({ error: (err as Error).message });
        }
      }
      pushToolResult(agent, call.toolCallId, result);
      executedIds.add(call.toolCallId);
    }
  }
  console.warn(
    "[turn-runner] frontend-tool loop hit iteration cap (%d); stopping.",
    maxIters,
  );
}

/**
 * If the agent's latest message isn't already the assistant message that
 * issued these tool calls, append one. AG-UI's HttpAgent middleware
 * *should* populate this from the streamed events, but we defensively
 * reconcile here so the next runAgent sees a valid transcript even on
 * backends that don't.
 */
function ensureAssistantToolCallMessage(
  agent: HttpAgent,
  calls: ReadonlyArray<CapturedToolCall>,
): void {
  const messages = agent.messages as Array<Record<string, unknown>>;
  const last = messages[messages.length - 1];
  const lastIsAssistantWithCalls =
    last !== undefined &&
    (last as { role?: string }).role === "assistant" &&
    Array.isArray((last as { toolCalls?: unknown[] }).toolCalls);

  if (lastIsAssistantWithCalls) {
    const existing = (
      (last as { toolCalls?: Array<{ id?: string }> }).toolCalls ?? []
    ).map((tc) => tc.id ?? "");
    const allPresent = calls.every((c) => existing.includes(c.toolCallId));
    if (allPresent) return;
  }

  agent.messages.push({
    id: newId(),
    role: "assistant",
    content: "",
    toolCalls: calls.map((c) => ({
      id: c.toolCallId,
      type: "function" as const,
      function: {
        name: c.toolCallName,
        arguments: JSON.stringify(c.toolCallArgs),
      },
    })),
  } as never);
}

function pushToolResult(
  agent: HttpAgent,
  toolCallId: string,
  content: string,
): void {
  agent.messages.push({
    id: newId(),
    role: "tool",
    toolCallId,
    content,
  } as never);
}
