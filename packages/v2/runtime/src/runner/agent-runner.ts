import { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import type { StateLoadableAgent } from "../types/state-loadable";

export interface AgentRunnerRunRequest {
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  headers?: Record<string, string>;
  stateLoader?: StateLoadableAgent;
}

export interface AgentRunnerIsRunningRequest {
  threadId: string;
}

export interface AgentRunnerStopRequest {
  threadId: string;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
}
