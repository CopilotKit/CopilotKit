import { RunnableConfig } from "@langchain/core/runnables";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { convertJsonSchemaToZodSchema, randomId } from "@copilotkit/shared";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";

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

export const CopilotKitPropertiesAnnotation = Annotation.Root({
  actions: Annotation<any[]>,
});

export const CopilotKitStateAnnotation = Annotation.Root({
  copilotkit: Annotation<typeof CopilotKitPropertiesAnnotation.State>,
  ...MessagesAnnotation.spec,
});

export type CopilotKitState = typeof CopilotKitStateAnnotation.State;
export type CopilotKitProperties = typeof CopilotKitPropertiesAnnotation.State;

export function copilotkitCustomizeConfig(
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

export async function copilotkitExit(config: RunnableConfig) {
  await dispatchCustomEvent("copilotkit_exit", {}, config);
}

export async function copilotkitEmitState(config: RunnableConfig, state: any) {
  await dispatchCustomEvent("copilotkit_manually_emit_intermediate_state", state, config);
}

export async function copilotkitEmitMessage(config: RunnableConfig, message: string) {
  await dispatchCustomEvent(
    "copilotkit_manually_emit_message",
    { message, message_id: randomId(), role: "assistant" },
    config,
  );
}

export async function copilotkitEmitToolCall(config: RunnableConfig, name: string, args: any) {
  await dispatchCustomEvent(
    "copilotkit_manually_emit_tool_call",
    { name, args, id: randomId() },
    config,
  );
}

export function convertActionToDynamicStructuredTool(actionInput: any) {
  return new DynamicStructuredTool({
    name: actionInput.name,
    description: actionInput.description,
    schema: convertJsonSchemaToZodSchema(actionInput.parameters, true),
    func: async () => {
      return "";
    },
  });
}

export function convertActionsToDynamicStructuredTools(actions: any[]) {
  return actions.map((action) => convertActionToDynamicStructuredTool(action));
}
