import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import type { Observable } from "rxjs";
import { THREAD_ALREADY_RUNNING_ERROR_CODE } from "@copilotkit/shared";

/**
 * Thrown by a runner when the thread already has a run in flight. The SSE
 * handler sends it to the client as a `RUN_ERROR` with
 * {@link THREAD_ALREADY_RUNNING_ERROR_CODE}, matched on `code` so a copy of
 * this class from another package version still counts.
 */
export class ThreadAlreadyRunningError extends Error {
  readonly code = THREAD_ALREADY_RUNNING_ERROR_CODE;

  constructor() {
    super("Thread already running");
    this.name = "ThreadAlreadyRunningError";
  }
}

export interface AgentRunnerRunRequest {
  threadId: string;
  /** Backend execution ID supplied by Intelligence for imported non-UUID sessions. */
  backendThreadId?: string;
  agent: AbstractAgent;
  input: RunAgentInput;
  persistedInputMessages?: Message[];
  /** Short-lived token scoped to this runner invocation. */
  authToken?: string;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  agentId?: string;
  headers?: Record<string, string>;
  joinCode?: string;
}

export interface AgentRunnerIsRunningRequest {
  threadId: string;
}

export interface AgentRunnerStopRequest {
  threadId: string;
  /** When present, stop only this exact run and never a newer run on the Thread. */
  runId?: string;
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
}
