import { ActivityMessage } from "@ag-ui/core";
import type { AbstractAgent } from "@ag-ui/client";
import { z } from "zod";
import type { Component, VNodeChild } from "vue";

export interface VueActivityMessageRendererProps<TActivityContent> {
  activityType: string;
  content: TActivityContent;
  message: ActivityMessage;
  agent: AbstractAgent | undefined;
}

export type VueActivityMessageRendererRenderFn<TActivityContent> =
  | ((props: VueActivityMessageRendererProps<TActivityContent>) => VNodeChild)
  | Component<VueActivityMessageRendererProps<TActivityContent>>;

export interface VueActivityMessageRenderer<TActivityContent> {
  activityType: string;
  agentId?: string;
  content: z.ZodSchema<TActivityContent>;
  render: VueActivityMessageRendererRenderFn<TActivityContent>;
}
