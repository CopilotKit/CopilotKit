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
  /**
   * @deprecated CopilotKit now emits all messages and tool calls by default.
   * Note: this only controls emitMessages and emitToolCalls — it does not
   * affect {@link emitRawEvents} or {@link emitRawEventData}.
   */
  emitAll?: boolean;
  emitIntermediateState?: IntermediateStateConfig[];
  /**
   * When false, suppresses standalone RAW event objects (LangChain callback wrappers
   * used by the CopilotKit web inspector). Does not affect the rawEvent field on
   * typed events — use {@link emitRawEventData} for that.
   */
  emitRawEvents?: boolean;
  /**
   * When false, strips the rawEvent field from typed events (text messages,
   * tool calls, state snapshots). Does not affect standalone RAW event objects —
   * use {@link emitRawEvents} for that.
   */
  emitRawEventData?: boolean;
}

export type CopilotKitState = typeof CopilotKitStateAnnotation.State;
export type CopilotKitProperties = typeof CopilotKitPropertiesAnnotation.State;
