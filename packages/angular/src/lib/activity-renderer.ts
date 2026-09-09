import {
  DestroyRef,
  InjectionToken,
  Type,
  Signal,
  inject,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import { CopilotKit } from "./copilotkit";

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

/** Register an activity renderer for the lifetime of the current injector. */
export function registerRenderActivityMessage(
  config: RenderActivityMessageConfig,
): void {
  const copilotKit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);

  copilotKit.addRenderActivityMessage(config);
  destroyRef.onDestroy(() => copilotKit.removeRenderActivityMessage(config));
}
