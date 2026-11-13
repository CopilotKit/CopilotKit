import { Type } from "@angular/core";
import {
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
