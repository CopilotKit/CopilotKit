import type { Type } from "@angular/core";
import type {
  A2uiClientAction,
  CatalogInterface,
  ComponentApi,
} from "@a2ui/web_core/v0_9";

/**
 * What a surface emits when the user triggers an action. CopilotKit sends it
 * to the agent as the `a2uiAction` run property.
 */
export interface A2UIClientEventMessage {
  userAction: A2uiClientAction;
}

/** A user action dispatched by an A2UI component, with resolved context values. */
export type A2UIUserAction = A2uiClientAction;

/**
 * Intercepts an A2UI action before it reaches the agent.
 *
 * Return `null` to handle it locally, an action to forward a modified action,
 * or `undefined` / `void` to forward the original action. Async callbacks are
 * awaited before forwarding.
 *
 * For manual forwarding, await `forward(action)` (or `forward()` for the
 * original action) and return `null` to avoid running the agent twice.
 */
export type A2UIActionInterceptor = (
  action: A2UIUserAction,
  forward: (action?: A2UIUserAction) => Promise<void>,
) => void | A2UIUserAction | null | Promise<void | A2UIUserAction | null>;

export interface A2UISurfaceError {
  error: unknown;
  message: string;
}

/**
 * What surfaces render with: `basicCatalog`, or one from `createAngularCatalog`,
 * both in `@copilotkit/angular/a2ui`. The main entry point mounts its
 * `surfaceComponent`, so it never imports the `/a2ui` entry point.
 */
export interface A2UICatalog extends CatalogInterface<ComponentApi> {
  readonly surfaceComponent: Type<unknown>;
}
