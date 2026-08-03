import type { ActivityMessage } from "@ag-ui/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { z } from "zod";

export interface SvelteActivityMessageRendererProps<TActivityContent> {
  activityType: string;
  content: TActivityContent;
  message: ActivityMessage;
  agent: AbstractAgent | undefined;
}

export type SvelteActivityMessageRendererRenderFn<TActivityContent> = (
  props: SvelteActivityMessageRendererProps<TActivityContent>,
) => any;

export interface SvelteActivityMessageRenderer<TActivityContent> {
  activityType: string;
  agentId?: string;
  content: z.ZodSchema<TActivityContent>;
  render: SvelteActivityMessageRendererRenderFn<TActivityContent>;
}
