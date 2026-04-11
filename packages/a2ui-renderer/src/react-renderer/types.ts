import type { A2UIClientEventMessage, Theme } from "../a2ui-types";

// Re-export for backward compatibility
export type { A2UIClientEventMessage, Theme };

// Legacy type aliases - these are simplified in v0.9
export type Types = Record<string, any>;
export type Primitives = Record<string, any>;
export type AnyComponentNode = any;
export type Surface = any;
export type SurfaceID = string;
export type ServerToClientMessage = Record<string, unknown>;
export type Action = any;
export type DataValue = any;
export type MessageProcessor = any;
export type StringValue = any;
export type NumberValue = any;
export type BooleanValue = any;

/**
 * @deprecated - v0.9 components are handled by the catalog system.
 */
export interface A2UIComponentProps<T = any> {
  node: T;
  surfaceId: string;
}

/** @deprecated - v0.9 components are loaded by the catalog. */
export type ComponentLoader<T = any> = () => Promise<{
  default: any;
}>;

/** @deprecated - v0.9 uses Catalog instead of ComponentRegistration. */
export interface ComponentRegistration<T = any> {
  component: any;
  lazy?: boolean;
}

/**
 * Callback for when a user action is dispatched.
 */
export type OnActionCallback = (
  message: A2UIClientEventMessage,
) => void | Promise<void>;

/**
 * Configuration options for the A2UI provider.
 */
export interface A2UIProviderConfig {
  onAction?: OnActionCallback;
  theme?: Theme;
}
