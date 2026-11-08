import type { GenerativeUIComponentDefinition } from "../catalog/catalog";

/**
 * A standard component without its framework component: what the model
 * sees (description, props, events, slots) and how the engine treats it.
 * Each framework adds its own component with `withComponents`.
 */
export type GenerativeUIComponentDeclaration = Omit<
  GenerativeUIComponentDefinition,
  "component"
>;

/**
 * The definitions of `createGenerativeUI`: each declaration with the
 * component of the same name.
 *
 * @example
 * ```ts
 * const layoutComponents = withComponents(layoutDeclarations, { Box, Column });
 * ```
 */
export function withComponents<
  Declarations extends Record<string, GenerativeUIComponentDeclaration>,
  Components extends { [Name in keyof Declarations]: unknown },
>(declarations: Declarations, components: Components) {
  const definitions: Record<string, unknown> = {};
  for (const name of Object.keys(declarations)) {
    definitions[name] = { ...declarations[name], component: components[name] };
  }
  return definitions as {
    [Name in keyof Declarations]: Declarations[Name] & {
      component: Components[Name];
    };
  };
}
