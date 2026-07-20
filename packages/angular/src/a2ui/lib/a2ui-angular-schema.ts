import type { BoundProperty } from "@a2ui/angular/v0_9";
import type { Signal, Type } from "@angular/core";
import { z } from "zod";
import type {
  A2UIAngularCatalog,
  A2UIAngularCatalogFunction,
} from "./a2ui-angular-catalog";

type StripPathBinding<T> = T extends { path: string } ? never : T;

/**
 * Derives the shape of a custom component's `props` input from its Zod
 * schema: every declared prop is exposed as a `BoundProperty` whose value
 * signal resolves literals as well as path bindings against the surface's
 * data model.
 */
export type ContextFromSchema<TSchema extends z.ZodObject<z.ZodRawShape>> = {
  [K in keyof z.infer<TSchema>]-?: BoundProperty<
    StripPathBinding<NonNullable<z.infer<TSchema>[K]>>
  >;
};

/**
 * Wraps a value schema in a union with a path-binding schema.
 *
 * Use this for every prop of a custom A2UI component so the agent can either
 * provide a literal value (e.g. `"Paris"`) or a path binding into the
 * surface's data model (e.g. `{ path: "/flight/to" }`).
 */
export const binding = <T extends z.ZodTypeAny>(value: T) =>
  z.union([value, z.object({ path: z.string() }).strict()]);

/**
 * A fully typed custom-component entry: the shape of the component's `props`
 * input is derived from the Zod schema via {@link ContextFromSchema}, so
 * component and schema cannot drift apart.
 */
export interface A2UIAngularComponentEntry<
  TName extends string = string,
  TSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  name: TName;
  description: string;
  schema: TSchema;
  component: Type<{
    props: Signal<ContextFromSchema<TSchema>>;
  }>;
}

/**
 * Identity helper for defining a custom catalog component. Keeps name,
 * description, prop schema, and Angular component together and verifies at
 * compile time that the component's `props` input matches the schema.
 */
export function createCustomComponent<
  const TName extends string,
  const TSchema extends z.ZodObject<z.ZodRawShape>,
>(
  entry: A2UIAngularComponentEntry<TName, TSchema>,
): A2UIAngularComponentEntry<TName, TSchema> {
  return entry;
}

/**
 * Identity helper for defining a custom catalog function. Gives `execute`
 * full argument type inference from the Zod `schema`.
 */
export function createCustomFunction<
  const TName extends string,
  const TSchema extends z.ZodTypeAny,
>(
  fn: A2UIAngularCatalogFunction<TName, TSchema>,
): A2UIAngularCatalogFunction<TName, TSchema> {
  return fn;
}

/**
 * Identity helper for defining a custom catalog from component and function
 * entries while preserving their literal types.
 */
export function createCustomCatalog<const TCatalog extends A2UIAngularCatalog>(
  catalog: TCatalog,
): TCatalog {
  return catalog;
}
