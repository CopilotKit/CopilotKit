import type { Type } from "@angular/core";

export interface A2UISurfaceError {
  error: unknown;
  message: string;
}

/**
 * A catalog that brings its own renderer, created by `createAngularCatalog`
 * in `@copilotkit/angular/a2ui`. The main entry point renders its
 * `surfaceComponent`, so it never imports the `/a2ui` entry point.
 */
export interface NativeA2UICatalog {
  readonly id: string;
  /** Component names with the zod schemas advertised to the agent. */
  readonly components: ReadonlyMap<string, { readonly schema: unknown }>;
  readonly surfaceComponent: Type<unknown>;
}

export function isNativeA2UICatalog(
  value: unknown,
): value is NativeA2UICatalog {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as NativeA2UICatalog).id === "string" &&
    (value as NativeA2UICatalog).components instanceof Map &&
    typeof (value as NativeA2UICatalog).surfaceComponent === "function"
  );
}
