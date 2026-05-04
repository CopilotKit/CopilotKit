import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

export const CopilotKitPropertiesAnnotation = Annotation.Root({
  actions: Annotation<any[]>,
  context: Annotation<{ description: string; value: string }[]>,
  interceptedToolCalls: Annotation<any[]>,
  originalAIMessageId: Annotation<string>,
});

export const CopilotKitStateAnnotation = Annotation.Root({
  copilotkit: Annotation<typeof CopilotKitPropertiesAnnotation.State>,
  ...MessagesAnnotation.spec,
});

export interface IntermediateStateConfig {
  stateKey: string;
  tool: string;
  toolArgument?: string;
}

export interface OptionsConfig {
  emitToolCalls?: boolean | string | string[];
  emitMessages?: boolean;
  emitAll?: boolean;
  emitIntermediateState?: IntermediateStateConfig[];
}

export type CopilotKitState = typeof CopilotKitStateAnnotation.State;
export type CopilotKitProperties = typeof CopilotKitPropertiesAnnotation.State;
