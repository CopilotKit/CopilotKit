import { EventType, RunStartedEvent, type BaseEvent } from "@ag-ui/client";
import { InjectionToken, Injectable, inject } from "@angular/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { StepwiseAgent } from "./step-wise.agent";

type OpenRun = { readonly runId: string; readonly threadId: string };

/** Stepwise agents created by `provideCopilotKitFake`, keyed by agent id. */
export const FAKE_STEPWISE_AGENTS = new InjectionToken<
  ReadonlyMap<string, StepwiseAgent>
>("FAKE_STEPWISE_AGENTS");

@Injectable({ providedIn: "root" })
export class FakeRuntime {
  readonly #agents = inject(FAKE_STEPWISE_AGENTS);
  /** Identity of the protocol run opened by the latest RUN_STARTED, per agent. */
  #runs = new Map<string, OpenRun>();

  emit<T extends BaseEvent>(event: T, agentId = DEFAULT_AGENT_ID): void {
    if (this.isRunStartedEvent(event)) {
      this.#runs.set(agentId, { runId: event.runId, threadId: event.threadId });
    }
    if ([EventType.RUN_FINISHED, EventType.RUN_ERROR].includes(event.type)) {
      this.#runs.delete(agentId);
    }
    this.#agent(agentId).emit(event);
  }

  emitActivityMessage(
    content: Record<string, unknown>,
    activityType: string,
    messageId = crypto.randomUUID(),
    agentId = DEFAULT_AGENT_ID,
  ) {
    this.runIfInactive(agentId);
    this.emit(
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId,
        activityType,
        content,
      },
      agentId,
    );
  }

  complete(): void {
    this.#runs.clear();
    for (const agent of this.#agents.values()) {
      agent.complete();
    }
  }

  #agent(agentId: string): StepwiseAgent {
    const agent = this.#agents.get(agentId);
    if (!agent) {
      throw new Error(`FakeRuntime has no agent '${agentId}'.`);
    }
    return agent;
  }

  private runIfInactive(agentId: string) {
    if (this.#runs.has(agentId)) return;
    this.emit(
      {
        type: EventType.RUN_STARTED,
        threadId: this.#agent(agentId).threadId,
        runId: crypto.randomUUID(),
      },
      agentId,
    );
  }

  private isRunStartedEvent(event: BaseEvent): event is RunStartedEvent {
    return event.type === EventType.RUN_STARTED;
  }
}
