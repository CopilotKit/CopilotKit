import { InjectionToken, Type, Signal } from "@angular/core";
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

/**
 * Extension point used by optional secondary entry points to contribute
 * lower-precedence built-in activity renderers.
 *
 * @internal
 */
export const ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS = new InjectionToken<
  RenderActivityMessageConfig[]
>("COPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS", { factory: () => [] });

export const anyActivityContentSchema: AngularActivityContentSchema<unknown> = {
  safeParse: (content: unknown) => ({ success: true, data: content }),
};
