/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/sdk-js/langchain — CopilotKitProperties:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langchain — CopilotKitPropertiesAnnotation:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langchain — CopilotKitPropertiesSchema:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langchain — CopilotKitState:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langchain — CopilotKitStateAnnotation:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitProperties:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitPropertiesAnnotation:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitPropertiesSchema:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitState:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitStateAnnotation:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — IntermediateStateConfig:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — OptionsConfig:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — StandardSerializableSchema:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

export interface StandardSerializableSchema<Input, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => { value: Output } | { issues: ReadonlyArray<{ message: string }> };
    readonly types?: { readonly input: Input; readonly output: Output };
    readonly jsonSchema: {
      readonly input: (options: { target: string }) => Record<string, unknown>;
      readonly output: (options: { target: string }) => Record<string, unknown>;
    };
  };
}

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

const COPILOTKIT_PROPERTIES_JSON_SCHEMA = {
  type: "object",
  properties: {
    actions: { type: "array", items: {} },
    context: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          value: { type: "string" },
        },
        required: ["description", "value"],
      },
    },
    interceptedToolCalls: { type: "array", items: {} },
    originalAIMessageId: { type: "string" },
  },
};

/**
 * Standard Schema describing the `copilotkit` field on agent state.
 *
 * CopilotKit populates these fields at runtime, so the schema accepts any
 * input shape. Use it with `new StateSchema({ ...CopilotKitStateSchema.fields })`.
 */
export const CopilotKitPropertiesSchema: StandardSerializableSchema<
  typeof CopilotKitPropertiesAnnotation.State
> = {
  "~standard": {
    version: 1,
    vendor: "@copilotkit/sdk-js",
    validate: (value) => ({
      value: value as typeof CopilotKitPropertiesAnnotation.State,
    }),
    jsonSchema: {
      input: () => COPILOTKIT_PROPERTIES_JSON_SCHEMA,
      output: () => COPILOTKIT_PROPERTIES_JSON_SCHEMA,
    },
  },
};

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
