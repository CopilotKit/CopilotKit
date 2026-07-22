import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import type { Observable } from "rxjs";

export interface AgentRunnerRunRequest {
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
  persistedInputMessages?: Message[];
}

/**
 * A single inner agent invocation issued from inside an outer Channel-turn run
 * (see {@link AgentRunner.execute}). Mirrors {@link AgentRunnerRunRequest} but
 * carries no persistence concerns — the outer run owns history and terminals.
 */
export interface AgentTurnRunRequest {
  agent: AbstractAgent;
  input: RunAgentInput;
}

/**
 * Handed to the {@link AgentRunnerExecuteRequest.turn} body. The turn may call
 * {@link runAgent} zero or more times; the runner forwards each inner run's
 * non-lifecycle events to canonical history + local rendering and suppresses
 * inner `RUN_STARTED` / `RUN_FINISHED` so the OUTER run emits exactly one
 * `RUN_STARTED` and exactly one terminal event. `signal` aborts when the turn
 * is stopped or superseded.
 */
export interface AgentTurnController {
  runAgent(request: AgentTurnRunRequest): Promise<void>;
  readonly signal: AbortSignal;
}

/**
 * Request for a single fenced OUTER run wrapping a complete Channel turn.
 *
 * DERIVED CONTRACT (review assumption A9): the "existing planned `execute`"
 * the implementation plan references lives in a private artifact not present in
 * this repo. This shape is derived from Task 1's behavioral spec and
 * {@link IntelligenceAgentRunner}'s existing `executeAgentRun`. Behavior matches
 * the spec; the shape/naming must be reconciled against the planned artifact
 * before the beta cut.
 */
export interface AgentRunnerExecuteRequest {
  threadId: string;
  /** Canonical outer run identity. */
  runId: string;
  /**
   * Stable event namespace for durable-ack correlation across the outer run.
   * Optional until the durable-ack wiring lands.
   */
  namespace?: string;
  input: RunAgentInput;
  persistedInputMessages?: Message[];
  /** The Channel turn body; may invoke `controller.runAgent` zero or more times. */
  turn: (controller: AgentTurnController) => Promise<void>;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  headers?: Record<string, string>;
  joinCode?: string;
}

export interface AgentRunnerIsRunningRequest {
  threadId: string;
}

export interface AgentRunnerStopRequest {
  threadId: string;
}

export interface LocalThreadEndpointRecord {
  id: string;
  name: string | null;
  agentId: string;
  organizationId: string;
  createdById: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocalThreadEndpointRunner extends AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints: true;
  listThreads(): LocalThreadEndpointRecord[];
  getThreadMessages(threadId: string): Message[];
  getThreadEvents(threadId: string): BaseEvent[];
  getThreadState(threadId: string): Record<string, unknown> | null;
  clearThreads(): void;
}

export function supportsLocalThreadEndpoints(
  runner: AgentRunner,
): runner is LocalThreadEndpointRunner {
  return runner.ɵsupportsLocalThreadEndpoints === true;
}

export abstract class AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints?: boolean;

  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;

  /**
   * Run a complete Channel turn as one fenced OUTER run that may invoke the
   * selected agent multiple times (see {@link AgentRunnerExecuteRequest}).
   *
   * Fail-loud default: backends opt in by overriding this. It is intentionally
   * NOT abstract yet so backends can be migrated one at a time (Task 1); it is
   * converted to `abstract` once InMemory, Intelligence, SQLite, and the
   * telemetry wrappers all implement it.
   */
  execute(_request: AgentRunnerExecuteRequest): Observable<BaseEvent> {
    throw new Error(
      `${this.constructor.name} does not implement execute() (outer Channel-turn run)`,
    );
  }
}
