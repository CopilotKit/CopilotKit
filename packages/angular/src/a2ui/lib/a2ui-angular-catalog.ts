import type { Type } from "@angular/core";
import type { z } from "zod";

/**
 * Return type of a custom catalog function, as declared towards the A2UI
 * renderer's expression evaluator.
 */
export type A2UIAngularFunctionReturnType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "any"
  | "void";

/**
 * A custom component contributed to an A2UI catalog and rendered by a plain
 * Angular component.
 *
 * The agent references the component by `name` in its emitted A2UI operations.
 * The renderer instantiates `component` and binds every property declared in
 * `schema` as a `BoundProperty` on the component's `props` input.
 */
export interface A2UIAngularCatalogComponent {
  name: string;
  description: string;
  component: Type<unknown>;
  schema: z.ZodTypeAny;
}

/**
 * A custom function contributed to an A2UI catalog and callable from A2UI
 * expressions. Arguments are validated against `schema` before `execute`
 * is invoked.
 */
export interface A2UIAngularCatalogFunction<
  TName extends string = string,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: TName;
  description: string;
  returnType: A2UIAngularFunctionReturnType;
  schema: TSchema;
  execute: (args: z.infer<TSchema>) => unknown;
}

/**
 * Describes a custom A2UI catalog: a stable catalog id plus the Angular
 * components and functions that extend the standard basic catalog under
 * that id.
 */
export interface A2UIAngularCatalog {
  id: string;
  components: A2UIAngularCatalogComponent[];
  functions?: A2UIAngularCatalogFunction[];
}
