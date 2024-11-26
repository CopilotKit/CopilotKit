import { RunnableConfig } from "@langchain/core/runnables";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { randomId } from "@copilotkit/shared";

interface IntermediateStateConfig {
  stateKey: string;
  tool: string;
  toolArgument?: string;
}

interface OptionsConfig {
  emitToolCalls?: boolean | string | string[];
  emitMessages?: boolean;
  emitAll?: boolean;
  emitIntermediateState?: IntermediateStateConfig[];
}

export function copilotKitCustomizeConfig(
  baseConfig: RunnableConfig,
  options?: OptionsConfig,
): RunnableConfig {
  const metadata = baseConfig?.metadata || {};

  if (options?.emitAll) {
    metadata["copilotkit:emit-tool-calls"] = true;
    metadata["copilotkit:emit-messages"] = true;
  } else {
    if (options?.emitToolCalls !== undefined) {
      metadata["copilotkit:emit-tool-calls"] = options.emitToolCalls;
    }
    if (options?.emitMessages !== undefined) {
      metadata["copilotkit:emit-messages"] = options.emitMessages;
    }
  }

  if (options?.emitIntermediateState) {
    const snakeCaseIntermediateState = options.emitIntermediateState.map((state) => ({
      tool: state.tool,
      tool_argument: state.toolArgument,
      state_key: state.stateKey,
    }));

    metadata["copilotkit:emit-intermediate-state"] = snakeCaseIntermediateState;
  }

  baseConfig = baseConfig || {};

  return {
    ...baseConfig,
    metadata: metadata,
  };
}

export async function copilotKitExit(config: RunnableConfig) {
  await dispatchCustomEvent("copilotkit_exit", {}, config);
}

export async function copilotKitEmitState(config: RunnableConfig, state: any) {
  await dispatchCustomEvent("copilotkit_manually_emit_intermediate_state", state, config);
}

export async function copilotKitEmitMessage(config: RunnableConfig, message: string) {
  await dispatchCustomEvent(
    "copilotkit_manually_emit_message",
    { message, message_id: randomId(), role: "assistant" },
    config,
  );
}

export async function copilotKitEmitToolCall(config: RunnableConfig, name: string, args: any) {
  await dispatchCustomEvent(
    "copilotkit_manually_emit_tool_call",
    { name, args, id: randomId() },
    config,
  );
}
