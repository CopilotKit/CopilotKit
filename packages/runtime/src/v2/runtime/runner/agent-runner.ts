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
