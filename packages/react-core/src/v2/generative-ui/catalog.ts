import type { ComponentType } from "react";
import { z } from "zod";
import type { GenerativeUIComponentManifest } from "@copilotkit/shared";
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

export interface GenerativeUICatalog {
  readonly id: string;
  readonly components: ReadonlyMap<string, GenerativeUIComponentDefinition>;
  readonly manifestComponents: Record<string, GenerativeUIComponentManifest>;
}

export interface CreateGenerativeUICatalogConfig {
  /** Catalog id; surfaces pin to it (use a versioned id, e.g. "acme/store@1"). */
  id: string;
  extends?: GenerativeUICatalog[];
  components: Record<string, GenerativeUIComponentDefinition>;
}

const EMPTY_PROPS = z.object({}).strict();

/**
 * Experimental. Defines the allowlist of React components an agent may render,
 * and compiles it to the serializable manifest sent to the agent.
 */
export function createGenerativeUICatalog(
  config: CreateGenerativeUICatalogConfig,
): GenerativeUICatalog {
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
    add(name, definition);

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
