import {
  PROTOCOL_VERSION,
  client as createClientApp,
  methods,
} from "@agentclientprotocol/sdk";
import type {
  ClientConnection,
  ClientContext,
  McpServer,
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

/** The private Intelligence boundary required by the public ACP client. */
export interface AcpAgentPlatform {
  ɵopenAcpRelay(params: {
    readonly agentId: string;
    readonly appUserId: string;
    readonly runtimeInstanceId: string;
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
  /** Absolute working directory interpreted by the external ACP agent. */
  readonly cwd: string;
  /** Extra absolute workspace roots interpreted by the external ACP agent. */
  readonly additionalDirectories?: readonly string[];
  /** MCP servers that the external ACP agent should connect to. */
  readonly mcpServers?: readonly McpServer[];
}

interface PendingPermission {
  readonly interruptId: string;
  readonly request: RequestPermissionRequest;
  readonly resolve: (response: RequestPermissionResponse) => void;
  readonly reject: (error: unknown) => void;
}

interface ActiveTurn {
  readonly threadId: string;
  connection?: ClientConnection;
  context?: ClientContext;
  finished: boolean;
  identity: AcpRunIdentity;
  pendingPermission?: PendingPermission;
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

  constructor(
    private readonly config: AcpAgentConfig,
    private readonly coordinator = new AcpAgentCoordinator(),
  ) {
    super();
  }

  /** Reports the AG-UI features exposed by the ACP translation. */
  async getCapabilities(): Promise<AgentCapabilities> {
    return {
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
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
      finished: false,
      identity: { runId: input.runId, threadId: input.threadId },
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
    const relay = await this.config.intelligence.ɵopenAcpRelay({
      agentId: this.config.agentId,
      appUserId: this.config.userId,
      runtimeInstanceId: this.config.runtimeInstanceId,
      threadId: input.threadId,
    });
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
            turn.pendingPermission = {
              interruptId,
              reject,
              request: params,
              resolve,
            };
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

    const initialized = await connection.agent.request(
      methods.agent.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "CopilotKit AcpAgent", version: "1" },
      },
    );
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new AcpRunFailure(
        "acp_protocol_version_mismatch",
        `The external agent selected ACP v${initialized.protocolVersion}`,
      );
    }

    const sessionRequest = {
      cwd: this.config.cwd,
      mcpServers: [...(this.config.mcpServers ?? [])],
      ...(this.config.additionalDirectories
        ? { additionalDirectories: [...this.config.additionalDirectories] }
        : {}),
    };
    if (relay.remoteSessionId) {
      if (!initialized.agentCapabilities?.loadSession) {
        throw new AcpRunFailure(
          "acp_session_load_unsupported",
          "The external agent cannot load the durable ACP session",
        );
      }
      turn.remoteSessionId = relay.remoteSessionId;
      await connection.agent.request(methods.agent.session.load, {
        ...sessionRequest,
        sessionId: relay.remoteSessionId,
      });
    } else {
      const created = await connection.agent.request<
        NewSessionResponse,
        NewSessionRequest
      >(methods.agent.session.new, sessionRequest);
      turn.remoteSessionId = created.sessionId;
      await relay.saveRemoteSessionId(created.sessionId);
    }

    const response = await connection.agent.request(
      methods.agent.session.prompt,
      {
        sessionId: turn.remoteSessionId,
        prompt: [...prompt],
      },
    );
    if (turn.finished) return;

    const finished = finishAcpPrompt(turn.state, turn.identity, response);
    turn.state = finished.state;
    emit(turn, finished.events);
    completeSegment(turn);
    this.finishTurn(turn);
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
    turn.pendingPermission?.reject(error);
    this.finishTurn(turn, error);
  }

  private finishTurn(turn: ActiveTurn, error?: unknown): void {
    turn.finished = true;
    this.coordinator.turns.delete(turn.threadId);
    turn.connection?.close(error);
    if (this.activeTurn === turn) {
      this.activeTurn = undefined;
    }
  }

  /** Sends stable `session/cancel` and lets the external agent finish the turn. */
  override abortRun(): void {
    const turn = this.activeTurn;
    if (!turn || turn.finished || !turn.context || !turn.remoteSessionId)
      return;
    turn.context
      .notify(methods.agent.session.cancel, { sessionId: turn.remoteSessionId })
      .catch(() => undefined);
    if (turn.pendingPermission) {
      turn.pendingPermission.resolve({ outcome: { outcome: "cancelled" } });
      turn.pendingPermission = undefined;
    }
  }

  /** Creates an idle agent that shares only active permission coordination. */
  clone(): AcpAgent {
    const cloned = new AcpAgent(this.config, this.coordinator);
    // AbstractAgent does not expose its middleware chain, but clones must keep it.
    // @ts-expect-error AbstractAgent.middlewares is private in @ag-ui/client.
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }
}
