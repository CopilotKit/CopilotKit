import {
  PROTOCOL_VERSION,
  client as createClientApp,
  methods,
} from "@agentclientprotocol/sdk";
import type {
  ClientConnection,
  ClientContext,
  NewSessionRequest,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  Stream,
} from "@agentclientprotocol/sdk";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { Observable } from "rxjs";
import type { Subscriber } from "rxjs";
import { resolveAcpPermissionResume } from "./acp-interrupt";
import { AcpPromptError, selectLatestAcpPrompt } from "./acp-prompt";
import {
  createAcpPermissionInterrupt,
  createAcpRunError,
  createAcpRunStarted,
  createAcpTranslationState,
  finishAcpPrompt,
  translateAcpSessionUpdate,
} from "./acp-translation";
import type { AcpRunIdentity, AcpTranslationState } from "./acp-translation";

/** One admitted Intelligence relay carrying unchanged stable ACP v1 frames. */
export interface AcpRelayConnection {
  readonly relaySessionId: string;
  readonly remoteSessionId: string | null;
  readonly stream: Stream;
  saveRemoteSessionId(remoteSessionId: string): Promise<void>;
}

/** The Intelligence relay boundary required by the public ACP client. */
export interface AcpAgentPlatform {
  ɵopenAcpRelay(params: {
    readonly agentId: string;
    readonly appUserId: string;
    readonly runtimeInstanceId: string;
    readonly signal: AbortSignal;
    readonly threadId: string;
  }): Promise<AcpRelayConnection>;
}

/** Configuration for one external ACP agent target. */
export interface AcpAgentConfig {
  /** Intelligence client authenticated for the owning project. */
  readonly intelligence: AcpAgentPlatform;
  /** Bare customer application-user id that owns the AG-UI thread. */
  readonly userId: string;
  /** Exact external relay instance that hosts the ACP connection. */
  readonly runtimeInstanceId: string;
  /** Exact ACP agent id declared by the external relay. */
  readonly agentId: string;
  /** Non-secret working directory selector interpreted by the external ACP agent. */
  readonly cwd: string;
  /** Enables process-local permission interrupts on one sticky live runtime. */
  readonly permissionMode?: "live";
  /** Maximum time to keep one process-local permission request open. */
  readonly permissionTimeoutMs?: number;
}

interface PendingPermission {
  readonly interruptId: string;
  readonly request: RequestPermissionRequest;
  readonly resolve: (response: RequestPermissionResponse) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ActiveTurn {
  abortRequested: boolean;
  readonly abortController: AbortController;
  cancelSent: boolean;
  readonly threadId: string;
  connection?: ClientConnection;
  context?: ClientContext;
  finished: boolean;
  identity: AcpRunIdentity;
  pendingPermission?: PendingPermission;
  promptStarted: boolean;
  remoteSessionId?: string;
  state: AcpTranslationState;
  subscriber?: Subscriber<BaseEvent>;
}

class AcpAgentCoordinator {
  readonly turns = new Map<string, ActiveTurn>();
}

class AcpRunFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AcpRunFailure";
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The ACP relay failed";

const emit = (turn: ActiveTurn, events: readonly BaseEvent[]): void => {
  for (const event of events) {
    turn.subscriber?.next(event);
  }
};

const completeSegment = (turn: ActiveTurn): void => {
  turn.subscriber?.complete();
  turn.subscriber = undefined;
};

const firstInterruptId = (event: BaseEvent | undefined): string | undefined => {
  if (event?.type !== "RUN_FINISHED") return undefined;
  const outcome = event.outcome;
  if (
    typeof outcome !== "object" ||
    outcome === null ||
    !("type" in outcome) ||
    outcome.type !== "interrupt" ||
    !("interrupts" in outcome) ||
    !Array.isArray(outcome.interrupts)
  ) {
    return undefined;
  }
  const first = outcome.interrupts[0];
  return typeof first === "object" &&
    first !== null &&
    "id" in first &&
    typeof first.id === "string"
    ? first.id
    : undefined;
};

/**
 * AG-UI agent that translates stable ACP v1 while Intelligence carries and
 * stores the unchanged protocol frames. The ACP agent itself runs elsewhere.
 */
export class AcpAgent extends AbstractAgent {
  private activeTurn?: ActiveTurn;
  private readonly permissionTimeoutMs: number;

  constructor(
    private readonly config: AcpAgentConfig,
    private readonly coordinator = new AcpAgentCoordinator(),
  ) {
    super();
    const permissionTimeoutMs = config.permissionTimeoutMs ?? 300_000;
    if (
      !Number.isSafeInteger(permissionTimeoutMs) ||
      permissionTimeoutMs <= 0 ||
      permissionTimeoutMs > 300_000
    ) {
      throw new TypeError(
        "permissionTimeoutMs must be a positive safe integer no greater than 300000",
      );
    }
    this.permissionTimeoutMs = permissionTimeoutMs;
  }

  /** Reports the AG-UI features exposed by the ACP translation. */
  override async getCapabilities(): Promise<AgentCapabilities> {
    return {
      transport: { streaming: true },
      ...(this.config.permissionMode === "live"
        ? { humanInTheLoop: { interrupts: true } }
        : {}),
    };
  }

  /** Starts one prompt segment or resumes one pending ACP permission request. */
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      if (input.resume?.length) {
        this.resumePermission(input, subscriber);
      } else {
        this.startPrompt(input, subscriber);
      }
    });
  }

  private startPrompt(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
  ): void {
    if (this.coordinator.turns.has(input.threadId)) {
      this.emitStandaloneError(
        input,
        subscriber,
        "acp_turn_active",
        "This thread already has an active ACP prompt",
      );
      return;
    }

    const turn: ActiveTurn = {
      abortRequested: false,
      abortController: new AbortController(),
      cancelSent: false,
      finished: false,
      identity: { runId: input.runId, threadId: input.threadId },
      promptStarted: false,
      state: createAcpTranslationState(),
      subscriber,
      threadId: input.threadId,
    };
    this.coordinator.turns.set(input.threadId, turn);
    this.activeTurn = turn;
    subscriber.next(createAcpRunStarted(turn.identity));

    this.runPrompt(turn, input).catch((error: unknown) => {
      this.failTurn(turn, error);
    });
  }

  private resumePermission(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
  ): void {
    const turn = this.coordinator.turns.get(input.threadId);
    const pending = turn?.pendingPermission;
    const resumes = input.resume ?? [];
    if (!turn || !pending || resumes.length !== 1) {
      this.emitStandaloneError(
        input,
        subscriber,
        "acp_resume_not_pending",
        "No matching ACP permission request is pending for this thread",
      );
      return;
    }

    turn.identity = { runId: input.runId, threadId: input.threadId };
    turn.subscriber = subscriber;
    turn.pendingPermission = undefined;
    clearTimeout(pending.timer);
    this.activeTurn = turn;
    subscriber.next(createAcpRunStarted(turn.identity));

    try {
      pending.resolve(
        resolveAcpPermissionResume(
          resumes[0]!,
          pending.request,
          pending.interruptId,
        ),
      );
    } catch (error) {
      pending.reject(error);
      this.failTurn(turn, error);
    }
  }

  private async runPrompt(
    turn: ActiveTurn,
    input: RunAgentInput,
  ): Promise<void> {
    const prompt = selectLatestAcpPrompt(input.messages);
    const relay = await this.raceAbort(
      turn,
      this.config.intelligence.ɵopenAcpRelay({
        agentId: this.config.agentId,
        appUserId: this.config.userId,
        runtimeInstanceId: this.config.runtimeInstanceId,
        signal: turn.abortController.signal,
        threadId: input.threadId,
      }),
    );
    if (turn.finished) return;

    const app = createClientApp({ name: "CopilotKit AcpAgent" })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (turn.finished || params.sessionId !== turn.remoteSessionId) return;
        const translated = translateAcpSessionUpdate(turn.state, params.update);
        turn.state = translated.state;
        emit(turn, translated.events);
      })
      .onRequest(
        methods.client.session.requestPermission,
        ({ params, requestId }) =>
          new Promise<RequestPermissionResponse>((resolve, reject) => {
            if (turn.finished || params.sessionId !== turn.remoteSessionId) {
              resolve({ outcome: { outcome: "cancelled" } });
              return;
            }
            if (this.config.permissionMode !== "live") {
              resolve({ outcome: { outcome: "cancelled" } });
              return;
            }
            if (turn.pendingPermission) {
              resolve({ outcome: { outcome: "cancelled" } });
              return;
            }
            const interrupt = createAcpPermissionInterrupt(
              turn.state,
              { ...turn.identity, requestId },
              params,
            );
            turn.state = interrupt.state;
            const interruptId = firstInterruptId(interrupt.events.at(-1));
            if (!interruptId) {
              reject(
                new Error("ACP permission interrupt could not be created"),
              );
              return;
            }
            const pending: PendingPermission = {
              interruptId,
              reject,
              request: params,
              resolve,
              timer: setTimeout(() => {
                if (turn.pendingPermission !== pending || turn.finished) return;
                turn.pendingPermission = undefined;
                resolve({ outcome: { outcome: "cancelled" } });
                const error = new AcpRunFailure(
                  "acp_permission_timeout",
                  "The ACP permission request expired",
                );
                setTimeout(() => {
                  if (!turn.finished) this.finishTurn(turn, error);
                }, 0);
              }, this.permissionTimeoutMs),
            };
            turn.pendingPermission = pending;
            emit(turn, interrupt.events);
            completeSegment(turn);
          }),
      );

    const connection = app.connect(relay.stream);
    turn.connection = connection;
    turn.context = connection.agent;
    connection.closed.then(() => {
      if (!turn.finished) {
        this.failTurn(
          turn,
          new AcpRunFailure(
            "acp_transport_error",
            "The ACP relay disconnected before the prompt finished",
          ),
        );
      }
    });

    await this.stopIfAborted(turn);

    const initialized = await this.raceAbort(
      turn,
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "CopilotKit AcpAgent", version: "1" },
      }),
    );
    await this.stopIfAborted(turn);
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new AcpRunFailure(
        "acp_protocol_version_mismatch",
        `The external agent selected ACP v${initialized.protocolVersion}`,
      );
    }

    const sessionRequest = {
      cwd: this.config.cwd,
      mcpServers: [],
    };
    if (relay.remoteSessionId) {
      if (!initialized.agentCapabilities?.loadSession) {
        throw new AcpRunFailure(
          "acp_session_load_unsupported",
          "The external agent cannot load the durable ACP session",
        );
      }
      turn.remoteSessionId = relay.remoteSessionId;
      await this.raceAbort(
        turn,
        connection.agent.request(methods.agent.session.load, {
          ...sessionRequest,
          sessionId: relay.remoteSessionId,
        }),
      );
    } else {
      const created = await this.raceAbort(
        turn,
        connection.agent.request<NewSessionResponse, NewSessionRequest>(
          methods.agent.session.new,
          sessionRequest,
        ),
      );
      turn.remoteSessionId = created.sessionId;
      await this.raceAbort(turn, relay.saveRemoteSessionId(created.sessionId));
    }
    await this.stopIfAborted(turn);

    turn.promptStarted = true;
    const response = await this.raceAbort(
      turn,
      connection.agent.request(methods.agent.session.prompt, {
        sessionId: turn.remoteSessionId,
        prompt: [...prompt],
      }),
    );
    if (turn.finished) return;

    const finished = finishAcpPrompt(turn.state, turn.identity, response);
    turn.state = finished.state;
    emit(turn, finished.events);
    completeSegment(turn);
    this.finishTurn(turn);
  }

  private async stopIfAborted(turn: ActiveTurn): Promise<void> {
    if (!turn.abortRequested) return;
    await this.sendCancel(turn);
    throw new AcpRunFailure(
      "acp_run_cancelled",
      "The ACP run was cancelled before the prompt started",
    );
  }

  private raceAbort<T>(turn: ActiveTurn, promise: Promise<T>): Promise<T> {
    const signal = turn.abortController.signal;
    if (signal.aborted) {
      return Promise.reject(
        new AcpRunFailure(
          "acp_run_cancelled",
          "The ACP run was cancelled before the prompt finished",
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const aborted = (): void => {
        reject(
          new AcpRunFailure(
            "acp_run_cancelled",
            "The ACP run was cancelled before the prompt finished",
          ),
        );
      };
      signal.addEventListener("abort", aborted, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", aborted);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", aborted);
          reject(error);
        },
      );
    });
  }

  private async sendCancel(turn: ActiveTurn): Promise<void> {
    if (turn.cancelSent || !turn.context || !turn.remoteSessionId) return;
    turn.cancelSent = true;
    await turn.context
      .notify(methods.agent.session.cancel, {
        sessionId: turn.remoteSessionId,
      })
      .catch(() => undefined);
  }

  private emitStandaloneError(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    code: string,
    message: string,
  ): void {
    subscriber.next(
      createAcpRunStarted({ runId: input.runId, threadId: input.threadId }),
    );
    const failed = createAcpRunError(createAcpTranslationState(), {
      code,
      message,
    });
    failed.events.forEach((event) => subscriber.next(event));
    subscriber.complete();
  }

  private failTurn(turn: ActiveTurn, error: unknown): void {
    if (turn.finished) return;
    const code =
      error instanceof AcpRunFailure
        ? error.code
        : error instanceof AcpPromptError
          ? "acp_prompt_error"
          : "acp_transport_error";
    const failed = createAcpRunError(turn.state, {
      code,
      message: errorMessage(error),
    });
    turn.state = failed.state;
    emit(turn, failed.events);
    completeSegment(turn);
    if (turn.pendingPermission) {
      clearTimeout(turn.pendingPermission.timer);
      turn.pendingPermission.reject(error);
      turn.pendingPermission = undefined;
    }
    this.finishTurn(turn, error);
  }

  private finishTurn(turn: ActiveTurn, error?: unknown): void {
    turn.finished = true;
    if (turn.pendingPermission) {
      clearTimeout(turn.pendingPermission.timer);
      turn.pendingPermission.resolve({ outcome: { outcome: "cancelled" } });
      turn.pendingPermission = undefined;
    }
    this.coordinator.turns.delete(turn.threadId);
    turn.connection?.close(error);
    if (this.activeTurn === turn) {
      this.activeTurn = undefined;
    }
  }

  /** Sends stable `session/cancel` and lets the external agent finish the turn. */
  override abortRun(): void {
    const turn = this.activeTurn;
    if (!turn || turn.finished) return;
    turn.abortRequested = true;
    if (turn.pendingPermission) {
      clearTimeout(turn.pendingPermission.timer);
      turn.pendingPermission.resolve({ outcome: { outcome: "cancelled" } });
      turn.pendingPermission = undefined;
    }
    if (turn.promptStarted) {
      this.sendCancel(turn).catch(() => undefined);
      return;
    }
    if (turn.context && turn.remoteSessionId) {
      this.sendCancel(turn)
        .finally(() => turn.abortController.abort())
        .catch(() => undefined);
    } else {
      turn.abortController.abort();
    }
  }

  /** Creates an idle agent that shares only active permission coordination. */
  override clone(): AcpAgent {
    const cloned = new AcpAgent(this.config, this.coordinator);
    // AbstractAgent does not expose its middleware chain, but clones must keep it.
    // @ts-expect-error AbstractAgent.middlewares is private in @ag-ui/client.
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }
}
