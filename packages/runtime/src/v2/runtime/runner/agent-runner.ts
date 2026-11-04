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

/** `code` of {@link ThreadAccessDeniedError}, also sent on the SSE `RUN_ERROR`. */
export const THREAD_ACCESS_DENIED_ERROR_CODE = "THREAD_ACCESS_DENIED";

/**
 * Thrown by a runner when a run targets a Thread that another identity owns.
 *
 * Defense in depth: the run handler checks `isThreadAccessible` first and
 * refuses with an HTTP error, so the runner throws this only when another
 * identity claims the Thread between that check and the run, or for direct
 * runner callers. A synchronous throw from `run()` is still mapped to the
 * HTTP error; a later one reaches the client as a `RUN_ERROR` with
 * {@link THREAD_ACCESS_DENIED_ERROR_CODE}. Neither is reported as an agent
 * failure. Matched on `code`, so a copy of this class from another package
 * version still counts.
 */
export class ThreadAccessDeniedError extends Error {
  readonly code = THREAD_ACCESS_DENIED_ERROR_CODE;

  constructor() {
    super("Thread access denied");
    this.name = "ThreadAccessDeniedError";
  }
}

/** True for a {@link ThreadAccessDeniedError}, from any package version. */
export function isThreadAccessDeniedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === THREAD_ACCESS_DENIED_ERROR_CODE
  );
}

/**
 * Owner of a Thread created, or reached, by a runner call that names no owner:
 * a run, connect, stop or isRunning without `ownerId`, or a Thread endpoint call
 * without a scope. Such calls come only from trusted server-side code (for
 * example a Channel listener), and they act as this one server identity.
 *
 * No HTTP caller can act as it: request identities are `""` (anonymous) or an
 * id that `identifyUser` returned, and a valid id cannot hold a NUL character.
 * So an omitted owner never means "every Thread", and a Thread created
 * server-side is never reachable by an anonymous caller.
 */
export const ɵSERVER_THREAD_OWNER = "\u0000server";

/** The owner a runner call acts as: `ownerId`, or the server owner when omitted. */
export function ɵresolveThreadOwner(ownerId: string | undefined): string {
  return ownerId ?? ɵSERVER_THREAD_OWNER;
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
  /**
   * Identity the run acts as. A runner that tracks owners records it on the
   * Thread's first run and refuses a run from any other identity. `""` is the
   * anonymous owner. When omitted, the run acts as {@link ɵSERVER_THREAD_OWNER}.
   */
  ownerId?: string;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  agentId?: string;
  headers?: Record<string, string>;
  joinCode?: string;
  /**
   * Caller identity. A Thread owned by another identity is treated as unknown.
   * When omitted, the call acts as {@link ɵSERVER_THREAD_OWNER}.
   */
  ownerId?: string;
}

export interface AgentRunnerIsRunningRequest {
  threadId: string;
  /**
   * Caller identity. A Thread owned by another identity reports "not running".
   * When omitted, the call acts as {@link ɵSERVER_THREAD_OWNER}.
   */
  ownerId?: string;
}

export interface AgentRunnerStopRequest {
  threadId: string;
  /** When present, stop only this exact run and never a newer run on the Thread. */
  runId?: string;
  /**
   * Caller identity. A run on a Thread owned by another identity is not
   * stopped. When omitted, the call acts as {@link ɵSERVER_THREAD_OWNER}.
   */
  ownerId?: string;
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

/**
 * Limits a local Thread endpoint call to the Threads of one owner. `""` is the
 * anonymous owner. A call without a scope acts as
 * {@link ɵSERVER_THREAD_OWNER}: it sees only Threads created server-side, never
 * every Thread.
 */
export interface LocalThreadEndpointScope {
  ownerId: string;
}

export interface LocalThreadEndpointRunner extends AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints: true;
  listThreads(scope?: LocalThreadEndpointScope): LocalThreadEndpointRecord[];
  getThreadMessages(
    threadId: string,
    scope?: LocalThreadEndpointScope,
  ): Message[];
  getThreadEvents(
    threadId: string,
    scope?: LocalThreadEndpointScope,
  ): BaseEvent[];
  getThreadState(
    threadId: string,
    scope?: LocalThreadEndpointScope,
  ): Record<string, unknown> | null;
  clearThreads(scope?: LocalThreadEndpointScope): void;
  /** See {@link ThreadOwnershipRunner.isThreadAccessible}. */
  isThreadAccessible(
    threadId: string,
    scope: LocalThreadEndpointScope,
  ): boolean;
}

export function supportsLocalThreadEndpoints(
  runner: AgentRunner,
): runner is LocalThreadEndpointRunner {
  return runner.ɵsupportsLocalThreadEndpoints === true;
}

/**
 * A runner that records each Thread's owner and enforces it. Implementing
 * `isThreadAccessible` is the promise that `run`, `connect`, `stop` and
 * `isRunning` honor `ownerId` the same way: a call never reaches a Thread that
 * another owner holds.
 */
export interface ThreadOwnershipRunner extends AgentRunner {
  /** False when the Thread id is held by an owner other than `scope`'s. */
  isThreadAccessible(
    threadId: string,
    scope: LocalThreadEndpointScope,
  ): boolean | Promise<boolean>;
}

/**
 * True when `runner` enforces Thread owners. Checks the method itself, so a
 * runner built against an older interface (one that sets the endpoint flag
 * but has no `isThreadAccessible`) is not taken to enforce them.
 */
export function enforcesThreadOwnership(
  runner: AgentRunner,
): runner is ThreadOwnershipRunner {
  return typeof runner.isThreadAccessible === "function";
}

export abstract class AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints?: boolean;

  /** See {@link ThreadOwnershipRunner}. Optional: not every runner tracks owners. */
  isThreadAccessible?(
    threadId: string,
    scope: LocalThreadEndpointScope,
  ): boolean | Promise<boolean>;

  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
}
