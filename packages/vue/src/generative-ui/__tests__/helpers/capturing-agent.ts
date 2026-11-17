import { waitFor } from "@testing-library/vue";
import { expect } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Subject, takeWhile } from "rxjs";
import type { CopilotKitCoreVue } from "../../../lib/vue-core";
import {
  runFinishedEvent,
  runStartedEvent,
} from "../../../__tests__/utils/test-helpers";

/**
 * Keeps the input of every run, so a test reads what the run sent. It works
 * like the React `MockStepwiseAgent`: the test emits the events, the stream
 * of a run ends at its RUN_FINISHED or RUN_ERROR event, and the next run of
 * the same agent reads the same subject.
 */
export class CapturingAgent extends AbstractAgent {
  static inputs: RunAgentInput[] = [];
  private subject = new Subject<BaseEvent>();

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    this.subject.next(event);
  }

  complete() {
    this.isRunning = false;
    this.subject.complete();
  }

  clone() {
    // A distinct object that shares the subject, so the test keeps control.
    const cloned = new CapturingAgent();
    cloned.agentId = this.agentId;
    cloned.subject = this.subject;
    return cloned;
  }

  // Nothing to tear down: the stream of each run ends at its terminal event.
  async detachActiveRun() {}

  run(input: RunAgentInput) {
    CapturingAgent.inputs.push(input);
    return this.subject.pipe(
      takeWhile(
        (event) =>
          event.type !== EventType.RUN_FINISHED &&
          event.type !== EventType.RUN_ERROR,
        true,
      ),
    );
  }
}

/** Runs `agent` once to the end. Returns the input of that run. */
export async function runOnce(
  copilotkit: CopilotKitCoreVue,
  agent: CapturingAgent,
) {
  const index = CapturingAgent.inputs.length;
  const pending = copilotkit.runAgent({ agent });
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(index + 1));
  agent.emit(runStartedEvent());
  agent.emit(runFinishedEvent());
  await pending;
  return CapturingAgent.inputs[index];
}
