import { inject, InjectionToken } from "@angular/core";
import type {
  ComponentContext,
  DataContext,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import type { CopilotA2UIComponentImplementation } from "./types";

/** Per-instance context of a catalog component; see {@link injectA2UIComponentContext}. */
export interface A2UIComponentContext {
  readonly surfaceId: string;
  readonly componentId: string;
  /** Absolute data-model path this component is scoped to. */
  readonly basePath: string;
  readonly theme: Record<string, unknown>;
  readonly surface: SurfaceModel<CopilotA2UIComponentImplementation>;
  readonly dataContext: DataContext;
  /** Dispatch a raw A2UI action, e.g. `{ event: { name, context } }`. */
  dispatch(action: unknown): Promise<void>;
  /** Write into the surface data model at a relative or absolute path. */
  set(path: string, value: unknown): void;
}

export const A2UI_COMPONENT_CONTEXT = new InjectionToken<A2UIComponentContext>(
  "A2UI_COMPONENT_CONTEXT",
);

/** Inject the {@link A2UIComponentContext} of the current catalog component. */
export function injectA2UIComponentContext(): A2UIComponentContext {
  return inject(A2UI_COMPONENT_CONTEXT);
}

/** @internal */
export function createA2UIComponentContext(
  context: ComponentContext,
  surface: SurfaceModel<CopilotA2UIComponentImplementation>,
): A2UIComponentContext {
  return {
    surfaceId: surface.id,
    componentId: context.componentModel.id,
    basePath: context.dataContext.path,
    theme: (context.theme ?? {}) as Record<string, unknown>,
    surface,
    dataContext: context.dataContext,
    dispatch: (action) => context.dispatchAction(action),
    set: (path, value) => context.dataContext.set(path, value),
  };
}
