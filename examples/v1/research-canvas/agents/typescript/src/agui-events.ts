/**
 * The AG-UI LangGraph events this agent sends to the UI. `@ag-ui/langgraph`
 * turns them into AG-UI events: a state snapshot, and a tool argument that
 * streams into state while the model writes it.
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

/** A tool argument to stream into `stateKey` while the model writes it. */
export interface PredictedState {
  stateKey: string;
  tool: string;
  toolArgument: string;
}

/** The config, set to stream each tool argument into its state key. */
export function withPredictedState(
  config: RunnableConfig,
  items: PredictedState[],
): RunnableConfig {
  return {
    ...config,
    metadata: {
      ...config.metadata,
      predict_state: items.map(({ stateKey, tool, toolArgument }) => ({
        state_key: stateKey,
        tool,
        tool_argument: toolArgument,
      })),
    },
  };
}

/** Send the current state to the UI before the node returns. */
export async function emitState(config: RunnableConfig, state: unknown) {
  await dispatchCustomEvent("manually_emit_state", state, config);
  // Give the event loop a turn so the event goes out before the node moves on.
  await new Promise((resolve) => setTimeout(resolve, 20));
}
