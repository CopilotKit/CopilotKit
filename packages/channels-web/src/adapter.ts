import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/core";
import type {
  ConversationStore,
  IngressSink,
  InteractionEvent,
  PlatformAdapter,
  RunRenderer,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import type {
  ChannelNode,
  MessageRef,
  ProviderActor,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import { WebConversationStore } from "./conversation-store.js";
import { LiveRun } from "./live-run.js";
import { NodeServer } from "./node-server.js";
import {
  actorFor,
  buildInteraction,
  buildTurn,
  parseRunRequest,
} from "./request.js";
import { createWebRunRenderer } from "./run-renderer.js";
import { irToText, serializeIr } from "./serialize.js";
import type {
  WebAdapterOptions,
  WebMessageRef,
  WebReplyTarget,
  WebUser,
} from "./types.js";
import { CHANNELS_UI_DELETE_EVENT, CHANNELS_UI_EVENT } from "./wire.js";
import type {
  ChannelsUiDeleteEventValue,
  ChannelsUiEventValue,
  WebUiNode,
} from "./wire.js";

/** Create a Web (AG-UI) adapter. Mirrors `slack(opts)`, `whatsapp(opts)`, … */
export function web(opts: WebAdapterOptions = {}): WebAdapter {
  return new WebAdapter(opts);
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Headers,
): Response {
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * A direct adapter that speaks AG-UI over HTTP.
 *
 * Any AG-UI client (`HttpAgent`, CopilotKit) can talk to a Channel through
 * it. Each request is one AG-UI run: the response is an SSE stream that
 * starts with `RUN_STARTED`, carries everything the Channel handler sends,
 * and ends with `RUN_FINISHED` when the handler returns.
 *
 * Output goes to the open response for its conversation (`threadId`). When
 * no response is open, output is dropped. There is no delivery after the
 * response ends.
 */
export class WebAdapter implements PlatformAdapter {
  readonly platform = "web";
  readonly capabilities: SurfaceCapabilities = {
    supportsMessageEvents: true,
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
    supportsSuggestedPrompts: false,
    supportsThreadTitle: false,
    supportsEphemeral: false,
    // A click arrives as a new request. `onInterrupt` + `thread.resume()`
    // is the supported human-in-the-loop path.
    supportsBlockingChoice: false,
  };
  readonly ackDeadlineMs = 30_000;
  readonly conversationStore: ConversationStore;

  private readonly store = new WebConversationStore();
  private readonly server: NodeServer | undefined;
  private readonly interruptEventNames: ReadonlySet<string>;
  private sink: IngressSink | undefined;
  /** Open responses per conversation, oldest first. */
  private readonly live = new Map<string, LiveRun[]>();

  constructor(private readonly opts: WebAdapterOptions = {}) {
    this.conversationStore = this.store;
    this.interruptEventNames =
      opts.interruptEventNames ?? new Set(["on_interrupt"]);
    this.server =
      opts.port === undefined
        ? undefined
        : new NodeServer({
            port: opts.port,
            host: opts.host,
            path: opts.path ?? "/",
            handler: (request) => this.handler(request),
          });
    this.handler = this.handler.bind(this);
  }

  /** The bound port of the `port` server, after `start()`. */
  get port(): number | undefined {
    return this.server?.port;
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
    await this.server?.start();
  }

  async stop(): Promise<void> {
    for (const runs of this.live.values()) {
      for (const run of runs) run.abort();
    }
    this.live.clear();
    await this.server?.stop();
    this.sink = undefined;
  }

  /**
   * Fetch-style request handler. Mount it on any route that receives AG-UI
   * run requests (Next.js route handler, Hono, Bun, Deno, a Worker, …).
   *
   * The Channel must be started first (`channel.start()`); before that the
   * handler answers `503`.
   */
  async handler(request: Request): Promise<Response> {
    const headers = this.corsHeaders(request);
    if (request.method === "OPTIONS") {
      headers.set("access-control-allow-methods", "POST, OPTIONS");
      headers.set(
        "access-control-allow-headers",
        request.headers.get("access-control-request-headers") ??
          "content-type, accept, authorization",
      );
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      headers.set("allow", "POST, OPTIONS");
      return jsonResponse(405, { error: "method not allowed" }, headers);
    }
    const sink = this.sink;
    if (!sink) {
      return jsonResponse(503, { error: "channel is not started" }, headers);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "body is not JSON" }, headers);
    }
    const parsed = parseRunRequest(body);
    if (!parsed.ok) return jsonResponse(400, { error: parsed.error }, headers);
    const { input } = parsed.request;

    let user: WebUser | null | undefined;
    try {
      user = await this.opts.getUser?.(request);
    } catch {
      return jsonResponse(401, { error: "unauthorized" }, headers);
    }
    const actor = actorFor(user, input.threadId);

    const run = new LiveRun(
      input.threadId,
      input.runId,
      request.headers.get("accept"),
    );
    this.register(run);
    const onAbort = () => {
      run.abort();
      this.unregister(run);
    };
    if (request.signal.aborted) onAbort();
    else request.signal.addEventListener("abort", onAbort, { once: true });

    const req = parsed.request;
    const work =
      req.kind === "turn"
        ? () => sink.onTurn(buildTurn(req, actor))
        : () => sink.onInteraction(buildInteraction(req, actor));
    void Promise.resolve()
      .then(work)
      .then(
        () => run.finish(),
        (error: unknown) => {
          console.error("[channels-web] handler failed:", error);
          run.fail(error);
        },
      )
      .finally(() => {
        request.signal.removeEventListener("abort", onAbort);
        this.unregister(run);
      });

    headers.set("content-type", run.contentType);
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
    return new Response(run.stream, { status: 200, headers });
  }

  render(ir: ChannelNode[]): WebUiNode[] {
    return serializeIr(ir);
  }

  async post(target: unknown, ir: ChannelNode[]): Promise<MessageRef> {
    const t = target as WebReplyTarget;
    const messageId = randomUUID();
    const run = this.route(t.threadId, t.runId);
    if (!run) {
      this.dropped("post", t.threadId);
    } else {
      const text = irToText(ir);
      run.emit({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent);
      if (text.length > 0) {
        run.emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: text,
        } as BaseEvent);
      }
      run.emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
      this.emitUi(run, messageId, ir);
    }
    return this.ref(messageId, t.threadId);
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    const r = ref as WebMessageRef;
    const run = this.route(r.threadId);
    if (!run) {
      this.dropped("update", r.threadId);
      return;
    }
    this.emitUi(run, r.id, ir);
  }

  async delete(ref: MessageRef): Promise<void> {
    const r = ref as WebMessageRef;
    const run = this.route(r.threadId);
    if (!run) {
      this.dropped("delete", r.threadId);
      return;
    }
    const value: ChannelsUiDeleteEventValue = { messageId: r.id };
    run.emit({
      type: EventType.CUSTOM,
      name: CHANNELS_UI_DELETE_EVENT,
      value,
    } as BaseEvent);
  }

  async stream(
    target: unknown,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as WebReplyTarget;
    const messageId = randomUUID();
    let run: LiveRun | undefined;
    let started = false;
    for await (const chunk of chunks) {
      if (!started) {
        started = true;
        run = this.route(t.threadId, t.runId);
        if (!run) this.dropped("stream", t.threadId);
        run?.emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        } as BaseEvent);
      }
      if (run && chunk.length > 0) {
        run.emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: chunk,
        } as BaseEvent);
      }
    }
    run?.emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    return this.ref(messageId, t.threadId);
  }

  createRunRenderer(target: unknown): RunRenderer {
    const t = target as WebReplyTarget;
    return createWebRunRenderer({
      resolve: () => this.route(t.threadId, t.runId),
      interruptEventNames: this.interruptEventNames,
    });
  }

  /**
   * Decode a `RunAgentInput` that carries `forwardedProps.channelInteraction`
   * into an interaction event for an anonymous actor. The request handler
   * does this itself; this method exists for custom transports.
   */
  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    const parsed = parseRunRequest(raw);
    if (!parsed.ok || parsed.request.kind !== "interaction") return undefined;
    return buildInteraction(
      parsed.request,
      actorFor(undefined, parsed.request.input.threadId),
    );
  }

  async lookupUser(_q: UserQuery): Promise<ProviderActor | undefined> {
    return undefined; // The web surface has no user directory.
  }

  async getMessages(target: unknown): Promise<ThreadMessage[]> {
    return this.store.getMessages(target as WebReplyTarget);
  }

  private emitUi(run: LiveRun, messageId: string, ir: ChannelNode[]): void {
    const value: ChannelsUiEventValue = { messageId, ir: serializeIr(ir) };
    run.emit({
      type: EventType.CUSTOM,
      name: CHANNELS_UI_EVENT,
      value,
    } as BaseEvent);
  }

  private ref(id: string, threadId: string): WebMessageRef {
    return { id, threadId };
  }

  /**
   * The open response for a conversation. The request that created the
   * target wins while it is open; otherwise the newest open request for the
   * conversation.
   */
  private route(threadId: string, runId?: string): LiveRun | undefined {
    const runs = this.live.get(threadId)?.filter((r) => r.isOpen) ?? [];
    if (runId !== undefined) {
      const own = runs.find((r) => r.runId === runId);
      if (own) return own;
    }
    return runs[runs.length - 1];
  }

  private register(run: LiveRun): void {
    const runs = this.live.get(run.threadId) ?? [];
    runs.push(run);
    this.live.set(run.threadId, runs);
  }

  private unregister(run: LiveRun): void {
    const runs = this.live.get(run.threadId);
    if (!runs) return;
    const rest = runs.filter((r) => r !== run);
    if (rest.length > 0) this.live.set(run.threadId, rest);
    else this.live.delete(run.threadId);
  }

  private dropped(operation: string, threadId: string): void {
    console.debug(
      `[channels-web] ${operation} dropped: no open request for thread ${threadId}`,
    );
  }

  private corsHeaders(request: Request): Headers {
    const headers = new Headers();
    const allowed = this.opts.allowedOrigins ?? [];
    const origin = request.headers.get("origin");
    if (!origin || allowed.length === 0) return headers;
    if (allowed.includes("*")) {
      headers.set("access-control-allow-origin", "*");
    } else if (allowed.includes(origin)) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "Origin");
    }
    return headers;
  }
}
