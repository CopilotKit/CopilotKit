import { Message } from "@ag-ui/core";
import type { Component, VNodeChild } from "vue";

export type VueCustomMessageRendererPosition = "before" | "after";

export interface VueCustomMessageRendererProps {
  message: Message;
  position: VueCustomMessageRendererPosition;
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}

export type VueCustomMessageRendererRenderFn =
  | ((props: VueCustomMessageRendererProps) => VNodeChild)
  | Component<VueCustomMessageRendererProps>
  | null;

export interface VueCustomMessageRenderer {
  agentId?: string;
  render: VueCustomMessageRendererRenderFn;
}
