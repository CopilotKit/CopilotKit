import { MemoryStore } from "@copilotkit/channels-core";
import type {
  IngressSink,
  PlatformAdapter,
  StateStore,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { LinearApiClient } from "./client.js";
import { LinearConversationStore } from "./conversation-store.js";
import { createRunRenderer } from "./event-renderer.js";
import type { LinearRunRenderer } from "./event-renderer.js";
import { prepareAgentSessionEvent } from "./ingress.js";
import { savePendingChoices } from "./pending-choices.js";
import { LINEAR_LIMITS, truncateText } from "./render/budget.js";
import { renderLinearMessage } from "./render/message.js";
import type {
  AgentSessionEventWebhook,
  LinearAdapterOptions,
  LinearMessageRef,
  ReplyTarget,
} from "./types.js";
import { createWebhookHandler } from "./webhook.js";
import { LinearWebhookServer } from "./webhook-server.js";

/**
 * Body of the `thought` posted as soon as a session is created. Linear marks
 * an agent unresponsive when it posts no activity within 10 s.
 */
const ACKNOWLEDGE_THOUGHT = "Looking into this…";
/** Final activity posted after a stop signal, so Linear marks the session stopped. */
const STOPPED_RESPONSE = "Stopped.";

/**
 * Create a Linear adapter for `createChannel`.
 *
 * @param opts - The app's OAuth access token (`actor=app`), the webhook
 *   signing secret, and optional server, API, and storage settings.
 * @example
 * const adapter = linear({
 *   accessToken: process.env.LINEAR_ACCESS_TOKEN!,
 *   webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *   port: 3000,
 * });
 * const channel = createChannel({ identifyUser: "platform", adapters: [adapter], agent });
 */
export function linear(opts: LinearAdapterOptions) {
  return new LinearAdapter(opts);
}

/**
 * Platform adapter for Linear's Agent API. One conversation is one agent
 * session, and every reply is an agent activity.
 *
 * - Inbound: Linear posts `AgentSessionEvent` webhooks. Mount
 *   {@link LinearAdapter.handleWebhook} in your server, or set `port` to use
 *   the built-in `node:http` server.
 * - `created` sessions get an ephemeral `thought` at once, then start a turn.
 * - A `prompted` message starts a turn, answers a pending `awaitChoice`, or,
 *   with the `stop` signal, aborts the session's run.
 * - Outbound: agent text is a `response`, tool calls are `action`s, and
 *   buttons or selects are an `elicitation` with the `select` signal.
 *
 * Activities cannot be edited or deleted, so `update` posts a new activity and
 * `delete` does nothing.
 */
export class LinearAdapter implements PlatformAdapter {
  readonly platform = "linear";
  readonly capabilities: SurfaceCapabilities = {
    supportsMessageEvents: true,
    supportsModals: false,
    // The ephemeral `thought` posted on `created` is Linear's typing signal.
    supportsTyping: true,
    supportsReactions: false,
    supportsStreaming: false,
    supportsEphemeral: false,
    supportsBlockingChoice: true,
  };
  /** Linear expects the webhook answered within 5 s. */
  readonly ackDeadlineMs = 5000;
  readonly conversationStore: LinearConversationStore;
  /**
   * Fetch-style handler for Linear webhooks. Mount it on the route you set as
   * the webhook URL in the Linear app settings. It verifies the signature and
   * reads the state the event needs. When that read fails it answers 500, so
   * Linear retries the delivery. Otherwise it answers 200 and dispatches the
   * event after the response.
   *
   * @example
   * app.post("/linear/webhook", (c) => adapter.handleWebhook(c.req.raw));
   */
  readonly handleWebhook: ReturnType<typeof createWebhookHandler>;

  private readonly client: LinearApiClient;
  /** Pending choice sets. Not the engine's `stateStore`: the adapter keeps its own. */
  private readonly adapterState: StateStore;
  private readonly server: LinearWebhookServer;
  private readonly port: number | undefined;
  private readonly interruptEventNames: ReadonlySet<string> | undefined;
  /** The run renderer of each session's running agent, so `stop` can silence it. */
  private readonly activeRenderers = new Map<string, LinearRunRenderer>();
  /**
   * Sessions whose first thought is being posted. A stop in that window sets
   * `stopped`, and the created turn then does not start.
   */
  private readonly acknowledging = new Map<string, { stopped: boolean }>();
  private sink: IngressSink | undefined;

  constructor(opts: LinearAdapterOptions) {
    this.client = new LinearApiClient({
      accessToken: opts.accessToken,
      apiUrl: opts.apiUrl,
      fetch: opts.fetch,
    });
    this.conversationStore = new LinearConversationStore({
      client: this.client,
    });
    this.adapterState = opts.stateStore ?? new MemoryStore();
    this.port = opts.port;
    this.interruptEventNames = opts.interruptEventNames;
    this.handleWebhook = createWebhookHandler({
      secret: opts.webhookSecret,
      onEvent: (event) => this.onEvent(event),
    });
    this.server = new LinearWebhookServer({
      handler: this.handleWebhook,
      path: opts.path,
    });
  }

  /** Keep the engine sink, and start the built-in server when `port` is set. */
  async start(sink: IngressSink) {
    this.sink = sink;
    if (this.port !== undefined) await this.server.start(this.port);
  }

  /** Stop the built-in server. Does nothing when it is not running. */
  async stop() {
    await this.server.stop();
  }

  render(ir: ChannelNode[]) {
    return renderLinearMessage(ir);
  }

  async post(target: ReplyTarget, ir: ChannelNode[]) {
    return this.postToSession(target.agentSessionId, ir);
  }

  /** Activities are immutable: post the new content as a new activity in the same session. */
  async update(ref: LinearMessageRef, ir: ChannelNode[]) {
    await this.postToSession(ref.agentSessionId, ir);
  }

  /** No live streaming: buffer every chunk, then post one `response`. */
  async stream(target: ReplyTarget, chunks: AsyncIterable<string>) {
    let text = "";
    for await (const chunk of chunks) text += chunk;
    const ref: LinearMessageRef = {
      id: "",
      agentSessionId: target.agentSessionId,
    };
    // Linear rejects an empty body; there is nothing to show anyway.
    if (text.trim().length === 0) return ref;
    const { id } = await this.client.createActivity(target.agentSessionId, {
      type: "response",
      body: truncateText(text, LINEAR_LIMITS.activityBody),
    });
    return { ...ref, id };
  }

  /** Linear has no API to delete an agent activity, so this does nothing. */
  async delete(_ref: LinearMessageRef) {}

  createRunRenderer(target: ReplyTarget) {
    const sessionId = target.agentSessionId;
    const renderer = createRunRenderer({
      client: this.client,
      target,
      interruptEventNames: this.interruptEventNames,
    });
    const unregister = () => {
      if (this.activeRenderers.get(sessionId) === tracked) {
        this.activeRenderers.delete(sessionId);
      }
    };
    // A failed post is logged by the renderer. Only a failed final post
    // fails the run, through `finish`. The renderer stays registered until
    // its posts settle, so a stop in that window waits for them before it
    // posts "Stopped.".
    const tracked: LinearRunRenderer = {
      ...renderer,
      async markInterrupted() {
        try {
          await renderer.markInterrupted();
        } finally {
          unregister();
        }
      },
      async finish() {
        try {
          await renderer.finish();
        } finally {
          unregister();
        }
      },
    };
    this.activeRenderers.set(sessionId, tracked);
    return tracked;
  }

  /** Picks arrive as `prompted` webhooks and are decoded at ingress, so there is nothing to decode here. */
  decodeInteraction(_raw: unknown) {
    return undefined;
  }

  /** The adapter does not read Linear's user directory. */
  async lookupUser(_q: UserQuery) {
    return undefined;
  }

  /** The session's user prompts and agent replies, oldest first. */
  getMessages(target: ReplyTarget) {
    return this.conversationStore.getMessages(target);
  }

  private async postToSession(agentSessionId: string, ir: ChannelNode[]) {
    const { content, signal, signalMetadata, choices } = this.render(ir);
    const { id } = await this.client.createActivity(agentSessionId, content, {
      signal,
      signalMetadata,
    });
    const ref: LinearMessageRef = { id, agentSessionId };
    if (choices.length > 0) {
      await savePendingChoices(this.adapterState, { messageRef: ref, choices });
    }
    return ref;
  }

  /**
   * Prepare a webhook event before the answer, and return its dispatch. For
   * a `created` session, dispatch first posts the acknowledge thought and does
   * not start the turn when a stop arrived while that thought was posted.
   */
  private async onEvent(event: AgentSessionEventWebhook) {
    const sink = this.sink;
    if (sink === undefined) {
      console.warn(
        "[channels-linear] dropped a webhook received before start()",
      );
      return undefined;
    }
    const sessionId = event.agentSession.id;
    const isCreated = event.action === "created";
    const dispatch = await prepareAgentSessionEvent(event, {
      sink: {
        onTurn: (turn) => {
          // A new session may have no `prompt` activity yet; give its first
          // turn the request from the webhook.
          if (isCreated) {
            this.conversationStore.primeSession(sessionId, turn.userText);
          }
          return sink.onTurn(turn);
        },
        onInteraction: (interaction) => sink.onInteraction(interaction),
      },
      stateStore: this.adapterState,
      onStop: (agentSessionId) => this.stopSession(agentSessionId),
    });
    if (!isCreated || dispatch === undefined) return dispatch;
    return async () => {
      const ack = { stopped: false };
      this.acknowledging.set(sessionId, ack);
      try {
        await this.acknowledgeSession(sessionId);
      } finally {
        this.acknowledging.delete(sessionId);
      }
      // The stop already posted `Stopped.`; do not start the run after it.
      if (ack.stopped) return;
      await dispatch();
    };
  }

  /**
   * Post an ephemeral `thought` so the session shows activity inside Linear's
   * 10 s window, before the agent runs. Best-effort: a failure is logged.
   */
  private async acknowledgeSession(agentSessionId: string) {
    try {
      await this.client.createActivity(
        agentSessionId,
        { type: "thought", body: ACKNOWLEDGE_THOUGHT },
        { ephemeral: true },
      );
    } catch (error) {
      console.error(
        `[channels-linear] failed to acknowledge session ${agentSessionId}`,
        error,
      );
    }
  }

  /**
   * Handle Linear's `stop` signal: abort the run, silence its renderer, then
   * post one final `response`. Linear sets the session status from the last
   * activity, so without it the session stays at "stopping".
   */
  private async stopSession(agentSessionId: string) {
    const ack = this.acknowledging.get(agentSessionId);
    if (ack !== undefined) ack.stopped = true;
    this.conversationStore.abortSession(agentSessionId);
    await this.activeRenderers.get(agentSessionId)?.markInterrupted();
    try {
      await this.client.createActivity(agentSessionId, {
        type: "response",
        body: STOPPED_RESPONSE,
      });
    } catch (error) {
      console.error(
        `[channels-linear] failed to confirm the stop of session ${agentSessionId}`,
        error,
      );
    }
  }
}
