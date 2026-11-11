import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import type { A2UIMiddlewareConfig } from "@ag-ui/a2ui-middleware";
import { firstValueFrom, from, toArray } from "rxjs";
import type { Observable } from "rxjs";
import { OpenGenerativeUIMiddleware } from "./open-generative-ui-middleware";
import { A2UIV09BridgeMiddleware } from "../generative-ui/a2ui-v09-middleware";

export interface RecordedEventTransformOptions {
  /**
   * Apply `A2UIMiddleware` with this configuration, including its catalog
   * when known. As in the runtime, its v0.9 surfaces are then converted to
   * A2UI 1.0 (`generative-ui-surface`).
   */
  a2ui?: A2UIMiddlewareConfig;
  openGenerativeUI?: boolean;
}

/** An inert event source: it cannot contact an agent or execute tools. */
class RecordedEventAgent extends AbstractAgent {
  constructor(
    private readonly input: RunAgentInput,
    private readonly stream: (input: RunAgentInput) => Observable<BaseEvent>,
  ) {
    super({
      threadId: input.threadId,
      initialMessages: input.messages,
      initialState: input.state,
    });
  }

  /** Emit recorded events through this layer without contacting an agent. */
  run(input: RunAgentInput): Observable<BaseEvent> {
    return this.stream(input);
  }

  /** Retain the current replay history and state in an independent agent. */
  clone(): AbstractAgent {
    return new RecordedEventAgent(
      { ...this.input, messages: this.messages, state: this.state },
      this.stream,
    );
  }
}

/**
 * Apply CPK's rich-UI middleware to one recorded, pre-middleware run.
 * Supply complete AG-UI run events and the original input/configuration. This
 * does not run an agent, fetch resources, or execute tools. Already transformed
 * histories must not be passed through a second time.
 *
 * Returns events in runtime order, including generated activity events and any
 * synthetic A2UI tool results. Persistence IDs, timestamps, and provenance are
 * the caller's responsibility (A2UI can generate random result message IDs).
 */
export async function transformRecordedEvents(
  input: RunAgentInput,
  events: readonly BaseEvent[],
  options: RecordedEventTransformOptions,
): Promise<BaseEvent[]> {
  let agent: AbstractAgent = new RecordedEventAgent(input, () => from(events));
  // Runtime registers the v0.9 bridge, then A2UI, then Open GenUI; the first
  // middleware is outermost.
  if (options.openGenerativeUI) {
    const next = agent;
    const middleware = new OpenGenerativeUIMiddleware();
    agent = new RecordedEventAgent(input, (runInput) =>
      middleware.run(runInput, next),
    );
  }
  if (options.a2ui) {
    const next = agent;
    const middleware = new A2UIMiddleware(options.a2ui);
    agent = new RecordedEventAgent(input, (runInput) =>
      middleware.run(runInput, next),
    );
    const inner = agent;
    const bridge = new A2UIV09BridgeMiddleware();
    agent = new RecordedEventAgent(input, (runInput) =>
      bridge.run(runInput, inner),
    );
  }
  return firstValueFrom(agent.run(input).pipe(toArray()));
}
