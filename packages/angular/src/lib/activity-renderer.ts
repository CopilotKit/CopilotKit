import { Type, Signal } from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";

export type AngularActivityContentParseResult<T> =
  | { success: true; data: T }
  | { success: false; error?: unknown };

export interface AngularActivityContentSchema<T> {
  safeParse(content: unknown): AngularActivityContentParseResult<T>;
}

export interface ActivityRenderer<TActivityContent = unknown> {
  activityType: Signal<string>;
  content: Signal<TActivityContent>;
  message: Signal<ActivityMessage>;
  agent: Signal<AbstractAgent | undefined>;
}

export interface RenderActivityMessageConfig<TActivityContent = unknown> {
  activityType: string;
  agentId?: string;
  content: AngularActivityContentSchema<TActivityContent>;
  component: Type<ActivityRenderer<TActivityContent>>;
}

export const anyActivityContentSchema: AngularActivityContentSchema<unknown> = {
  safeParse: (content: unknown) => ({ success: true, data: content }),
};
