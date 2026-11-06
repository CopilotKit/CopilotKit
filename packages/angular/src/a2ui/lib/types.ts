import { Type } from "@angular/core";
import { ComponentApi, ResolveA2uiProps } from "@a2ui/web_core/v0_9";
import { WebComponentImplementation } from "./universal";

/** A catalog entry rendered by an Angular component. */
export interface CopilotA2UIComponentImplementation extends ComponentApi {
  readonly component: Type<unknown>;
}

/** A catalog entry: an Angular component or a Custom Element. */
export type CopilotA2UICatalogEntry =
  | CopilotA2UIComponentImplementation
  | WebComponentImplementation;

/** A Custom Element to render a catalog entry with, instead of an Angular component. */
export type A2UIWebComponent = Pick<
  WebComponentImplementation,
  "tagName" | "element"
>;

/**
 * A Zod 3 schema, typed by the Zod copy `@a2ui/web_core` uses. A2UI catalogs
 * stay on Zod 3 because web_core's binder reads Zod 3 schema internals, while
 * the rest of this package uses Zod 4.
 */
export type A2UIPropsSchema = ComponentApi["schema"];

export interface A2UIComponentDefinition<
  Props extends A2UIPropsSchema = A2UIPropsSchema,
> {
  /** Zod 3 object schema for the component's props. */
  props: Props;
  /** Added to the schema advertised to the agent. */
  description?: string;
}

export type A2UICatalogDefinitions = Record<
  string,
  A2UIComponentDefinition<any>
>;

/**
 * Binder-resolved props for definition `K`: dynamic values become
 * primitives, actions become closures, child lists become `{ id, basePath }`
 * references, and dynamic props gain `set*` setters.
 */
export type A2UIProps<
  D extends A2UICatalogDefinitions,
  K extends keyof D,
> = ResolveA2uiProps<D[K]["props"]["_output"]>;

export type A2UIChildRef = string | { id: string; basePath?: string };
