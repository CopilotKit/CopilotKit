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

export type ToolCallEvents = ToolCallStartEvent | ToolCallArgsEvent | ToolCallEndEvent;

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
