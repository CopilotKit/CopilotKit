import type { Message } from "@ag-ui/core";

export type SvelteCustomMessageRendererPosition = "before" | "after";

export interface SvelteCustomMessageRendererProps {
  message: Message;
  position: SvelteCustomMessageRendererPosition;
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}

export type SvelteCustomMessageRendererRenderFn = (
  props: SvelteCustomMessageRendererProps,
) => any;

export interface SvelteCustomMessageRenderer {
  agentId?: string;
  render: SvelteCustomMessageRendererRenderFn;
}
