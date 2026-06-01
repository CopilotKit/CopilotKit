console.warn(
  "Warning: '@copilotkit/sdk-js/langchain' is deprecated and will be removed in a future release. Please use '@copilotkit/sdk-js/langgraph' instead.",
);

export {
  CopilotKitPropertiesAnnotation,
  CopilotKitPropertiesSchema,
  CopilotKitStateAnnotation,
  CopilotKitStateSchema,
  type CopilotKitState,
  type CopilotKitSchemaState,
  type CopilotKitSchemaUpdate,
  type CopilotKitProperties,
  copilotkitCustomizeConfig as copilotKitCustomizeConfig,
  copilotkitExit as copilotKitExit,
  copilotkitEmitState as copilotKitEmitState,
  copilotkitEmitMessage as copilotKitEmitMessage,
  copilotkitEmitToolCall as copilotKitEmitToolCall,
  convertActionToDynamicStructuredTool,
  convertActionsToDynamicStructuredTools,
} from "./langgraph";
