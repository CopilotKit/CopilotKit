export { CopilotRuntimeClient } from "./client";
export type { CopilotRuntimeClientOptions } from "./client";
export {
  Message,
  Role,
  TextMessage,
  ActionExecutionMessage,
  ResultMessage,
  AgentStateMessage,
  ImageMessage,
  langGraphInterruptEvent,
  convertMessagesToGqlInput,
  convertGqlOutputToMessages,
  filterAdjacentAgentStateMessages,
  filterAgentStateMessages,
  loadMessagesFromJsonRepresentation,
} from "./client";
export type { LangGraphInterruptEvent, MetaEvent, GraphQLError } from "./client";

// Auto-generated GraphQL types - kept as star export due to large number of generated types
export * from "./graphql/@generated/graphql";

export {
  aguiToGQL,
  aguiTextMessageToGQLMessage,
  aguiToolCallToGQLActionExecution,
  aguiToolMessageToGQLResultMessage,
  aguiMessageWithRenderToGQL,
  aguiMessageWithImageToGQLMessage,
  gqlToAGUI,
  gqlActionExecutionMessageToAGUIMessage,
  gqlTextMessageToAGUIMessage,
  gqlResultMessageToAGUIMessage,
  gqlImageMessageToAGUIMessage,
} from "./message-conversion";
