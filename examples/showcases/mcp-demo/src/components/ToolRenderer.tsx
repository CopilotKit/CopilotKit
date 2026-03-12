"use client";
 
import {
  useCopilotAction,
  CatchAllActionRenderProps,
} from "@copilotkit/react-core";
import MCPToolCall from "./MCPToolCall";
 
export function ToolRenderer() {
  useCopilotAction({
    /**
     * The asterisk (*) matches all tool calls
     */
    name: "*",
    render: ({ name, status, args, result }: CatchAllActionRenderProps<[]>) => {
        return <MCPToolCall status={status} name={name} args={args} result={result} />
    },
  });
  return null;
}