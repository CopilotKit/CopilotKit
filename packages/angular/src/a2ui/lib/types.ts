import { Type } from "@angular/core";
import { ComponentApi, ResolveA2uiProps } from "@a2ui/web_core/v0_9";
import { z, ZodObject, ZodRawShape } from "zod";
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

export interface A2UIComponentDefinition<T extends ZodRawShape = ZodRawShape> {
  props: ZodObject<T>;
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
> = ResolveA2uiProps<z.infer<D[K]["props"]>>;

export type A2UIChildRef = string | { id: string; basePath?: string };
