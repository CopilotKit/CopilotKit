/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/sdk-js/langchain — CopilotKitSchemaState:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langchain — CopilotKitSchemaUpdate:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langchain — CopilotKitStateSchema:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitSchemaState:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitSchemaUpdate:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js/langgraph — CopilotKitStateSchema:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/sdk-js/src/langgraph/state-schema.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
