import { MessagesValue, StateSchema } from "@langchain/langgraph";
import { CopilotKitPropertiesSchema } from "./types";

/**
 * CopilotKit agent state defined with LangGraph's modern
 * [`StateSchema`](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
 * API.
 *
 * Prefer this over `CopilotKitStateAnnotation` when starting a new
 * TypeScript agent. `Annotation.Root` is still supported by LangGraph but
 * `StateSchema` is the recommended API going forward.
 *
 * ### Example
 *
 * ```typescript
 * import { StateSchema } from "@langchain/langgraph";
 * import { CopilotKitStateSchema } from "@copilotkit/sdk-js/langgraph";
 * import { z } from "zod";
 *
 * export const AgentStateSchema = new StateSchema({
 *   language: z.enum(["english", "spanish"]),
 *   ...CopilotKitStateSchema.fields,
 * });
 *
 * export type AgentState = typeof AgentStateSchema.State;
 * ```
 */
export const CopilotKitStateSchema = new StateSchema({
  copilotkit: CopilotKitPropertiesSchema,
  messages: MessagesValue,
});

export type CopilotKitSchemaState = typeof CopilotKitStateSchema.State;
export type CopilotKitSchemaUpdate = typeof CopilotKitStateSchema.Update;
