/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime/langgraph — CustomEventNames:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime/langgraph — PredictStateTool:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime/langgraph — TextMessageEvents:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime/langgraph — ToolCallEvents:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * Constants for LangGraph integration.
 * This file is separate from langgraph.agent.ts to avoid pulling in @ag-ui/langgraph
 * when only these constants are needed.
 */

import {
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from "@ag-ui/client";

export type TextMessageEvents =
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent;

export type ToolCallEvents =
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent;

export enum CustomEventNames {
  CopilotKitManuallyEmitMessage = "copilotkit_manually_emit_message",
  CopilotKitManuallyEmitToolCall = "copilotkit_manually_emit_tool_call",
  CopilotKitManuallyEmitIntermediateState = "copilotkit_manually_emit_intermediate_state",
  CopilotKitExit = "copilotkit_exit",
}

export interface PredictStateTool {
  tool: string;
  state_key: string;
  tool_argument: string;
}
