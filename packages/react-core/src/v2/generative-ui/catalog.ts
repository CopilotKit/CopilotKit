import type { ComponentType, ReactNode } from "react";
import { z } from "zod";
import type { GenerativeUIComponentManifest } from "@copilotkit/shared";
import type { GenerativeUIInvokeResult } from "./errors";
import { toJsonSchema } from "./json-schema";

export type GenerativeUISlotKind = "single" | "multiple";

export interface GenerativeUIEventDefinition {
  description?: string;
  /** Arguments the component passes when it calls the event prop. */
  parameters: z.ZodTypeAny;
}

export interface GenerativeUIComponentDefinition<Props = any> {
  component: ComponentType<Props>;
  description?: string;
  /** Data the agent may supply. Literals or `{ path }` bindings. */
  props?: z.ZodObject<z.ZodRawShape>;
  /** Callback props, bound by the agent to a function or an agent event. */
  events?: Record<string, GenerativeUIEventDefinition>;
  /** Child props, filled with rendered child components. */
  slots?: Record<string, GenerativeUISlotKind>;
}

/**
 * Any function or class component. Unlike `ComponentType`, checking a value
 * against it does not read the component's props type. So a component can type
 * its props from `typeof catalog` without a circular type reference.
 */
type AnyComponent =
  | ((...args: never) => unknown)
  | (abstract new (...args: never) => unknown);

export type GenerativeUIComponentDefinitions = Record<
  string,
  Omit<GenerativeUIComponentDefinition, "component"> & {
    component: AnyComponent;
  }
>;

export interface GenerativeUICatalog<
  Components extends GenerativeUIComponentDefinitions =
    GenerativeUIComponentDefinitions,
> {
  readonly id: string;
  readonly components: ReadonlyMap<string, GenerativeUIComponentDefinition>;
  readonly manifestComponents: Record<string, GenerativeUIComponentManifest>;
  /**
   * Type only, never set at runtime. Keeps the definitions passed to
   * `createGenerativeUICatalog`, so `GenerativeUIEventHandler` can look up
   * event parameters.
   */
  readonly definitions?: Components;
}

type CatalogDefinitions<Catalog extends GenerativeUICatalog<any>> = NonNullable<
  Catalog["definitions"]
>;

type Simplify<T> = { [Key in keyof T]: T[Key] } & {};

type DataProps<Definition> = Definition extends {
  props?: infer Props extends z.ZodTypeAny;
}
  ? z.output<Props>
  : {};

type EventProps<Definition> = Definition extends {
  events?: infer Events extends Record<string, GenerativeUIEventDefinition>;
}
  ? {
      [Name in keyof Events]?: (
        args: z.input<Events[Name]["parameters"]>,
      ) => Promise<GenerativeUIInvokeResult>;
    }
  : {};

type SlotProps<Definition> = Definition extends {
  slots?: infer Slots extends Record<string, GenerativeUISlotKind>;
}
  ? { [Name in keyof Slots]?: ReactNode }
  : {};

/**
 * Props that the renderer passes to a catalog component:
 * `function CheckoutForm(props: GenerativeUIComponentProps<typeof catalog, "CheckoutForm">)`.
 * Data props are the parsed `props` schema. Event and slot props are present
 * only when the agent binds or fills them.
 */
export type GenerativeUIComponentProps<
  Catalog extends GenerativeUICatalog<any>,
  Name extends keyof CatalogDefinitions<Catalog> & string,
> = Simplify<
  DataProps<CatalogDefinitions<Catalog>[Name]> &
    EventProps<CatalogDefinitions<Catalog>[Name]> &
    SlotProps<CatalogDefinitions<Catalog>[Name]>
>;

export interface CreateGenerativeUICatalogConfig<
  Components extends GenerativeUIComponentDefinitions =
    GenerativeUIComponentDefinitions,
> {
  /** Catalog id; surfaces pin to it (use a versioned id, e.g. "acme/store@1"). */
  id: string;
  // ponytail: GenerativeUIEventHandler sees only this catalog's own components, not those of `extends`.
  extends?: GenerativeUICatalog[];
  components: Components;
}

const EMPTY_PROPS = z.object({}).strict();

/**
 * Experimental. Defines the allowlist of React components an agent may render,
 * and compiles it to the serializable manifest sent to the agent.
 */
export function createGenerativeUICatalog<
  Components extends GenerativeUIComponentDefinitions,
>(
  config: CreateGenerativeUICatalogConfig<Components>,
): GenerativeUICatalog<Components> {
  const components = new Map<string, GenerativeUIComponentDefinition>();
  const add = (name: string, definition: GenerativeUIComponentDefinition) => {
    if (components.has(name)) {
      throw new Error(
        `[generativeUI] Component "${name}" is defined more than once in catalog "${config.id}".`,
      );
    }
    assertDisjointKeys(name, definition);
    components.set(name, definition);
  };
  for (const base of config.extends ?? []) {
    for (const [name, definition] of base.components) add(name, definition);
  }
  for (const [name, definition] of Object.entries(config.components))
    add(name, definition as GenerativeUIComponentDefinition);

  const manifestComponents: Record<string, GenerativeUIComponentManifest> = {};
  for (const [name, definition] of components)
    manifestComponents[name] = toManifest(definition);
  return { id: config.id, components, manifestComponents };
}

const RESERVED_KEYS = new Set(["id", "component"]);

function assertDisjointKeys(
  name: string,
  definition: GenerativeUIComponentDefinition,
) {
  const seen = new Set<string>();
  const keys = [
    ...Object.keys(definition.props?.shape ?? {}),
    ...Object.keys(definition.events ?? {}),
    ...Object.keys(definition.slots ?? {}),
  ];
  for (const key of keys) {
    if (RESERVED_KEYS.has(key)) {
      throw new Error(
        `[generativeUI] "${key}" is reserved by A2UI and cannot be a prop, event or slot of component "${name}".`,
      );
    }
    if (seen.has(key)) {
      throw new Error(
        `[generativeUI] "${key}" is declared as more than one of prop, event, slot on component "${name}".`,
      );
    }
    seen.add(key);
  }
}

function toManifest(
  definition: GenerativeUIComponentDefinition,
): GenerativeUIComponentManifest {
  const manifest: GenerativeUIComponentManifest = {
    props: toJsonSchema((definition.props ?? EMPTY_PROPS).strict()),
  };
  if (definition.description) manifest.description = definition.description;
  if (definition.events) {
    manifest.events = Object.fromEntries(
      Object.entries(definition.events).map(([eventName, event]) => [
        eventName,
        {
          ...(event.description ? { description: event.description } : {}),
          parameters: toJsonSchema(event.parameters),
        },
      ]),
    );
  }
  if (definition.slots) manifest.slots = { ...definition.slots };
  return manifest;
}
