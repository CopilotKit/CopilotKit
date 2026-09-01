import { AbstractAgent } from "@ag-ui/client";
import type {
  AgentSubscriber,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core";

/**
 * One scripted `runAgent` invocation. Each step receives the subscriber the
 * run-loop passed into `runAgent` and simulates the agent's behaviour by
 * calling the subscriber's callbacks (e.g. `onToolCallEndEvent`,
 * `onCustomEvent`, `onRunFinishedEvent`).
 */
export type FakeAgentScriptStep = (
  subscriber: AgentSubscriber,
) => void | Promise<void>;

/**
 * A scriptable fake `AbstractAgent` for exercising the run/tool/interrupt
 * loop without a real backend. The constructor (or `setScript`) supplies an
 * ordered list of steps; each `runAgent` call shifts and runs the next step.
 */
export class FakeAgent extends AbstractAgent {
  private script: FakeAgentScriptStep[];
  /** Number of `runAgent` invocations seen — handy for loop-termination asserts. */
  runAgentCalls = 0;
  /** Every `runAgent` argument in order, for asserting what a run carried. */
  runAgentParameters: Array<RunAgentParameters | undefined> = [];
  /** Flipped to true by `abortRun()`. */
  aborted = false;

  constructor(script: FakeAgentScriptStep[] = []) {
    super({ agentId: "fake" });
    this.script = [...script];
  }

  setScript(script: FakeAgentScriptStep[]): void {
    this.script = [...script];
  }

  // The base class declares `run` abstract. It's never invoked here because
  // `runAgent` is overridden to drive the script directly (no rxjs stream).
  run(_input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    throw new Error("FakeAgent.run unused; runAgent is overridden");
  }

  override async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    this.runAgentCalls += 1;
    this.runAgentParameters.push(parameters);
    const step = this.script.shift();
    if (step && subscriber) {
      await step(subscriber);
    }
    return { result: undefined, newMessages: [] };
  }

  override abortRun(): void {
    this.aborted = true;
  }

  /**
   * Distinct instance for concurrent channel turns (singleton agent isolation).
   * Copies the remaining script so both prototype and clone can still drive steps.
   */
  override clone(): FakeAgent {
    const cloned = new FakeAgent(this.script);
    cloned.threadId = this.threadId;
    cloned.agentId = this.agentId;
    cloned.messages = structuredClone(this.messages);
    cloned.state = structuredClone(this.state);
    return cloned;
  }
}
