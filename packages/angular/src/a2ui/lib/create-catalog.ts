import type { Type } from "@angular/core";
import type { FunctionImplementation } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import { basicComponents } from "./basic/catalog";
import { CopilotA2UICatalog } from "./catalog";
import type {
  A2UICatalogDefinitions,
  CopilotA2UIComponentImplementation,
} from "./types";

const DEFAULT_CATALOG_ID = "copilotkit://angular-catalog";

export interface CreateAngularCatalogOptions {
  /** Identifier advertised to the agent. */
  catalogId?: string;
  /** Functions for bindings and expressions. Defaults to the A2UI basic functions; pass `[]` to disable. */
  functions?: FunctionImplementation[];
  /** Include the basic catalog's components; definitions with the same name replace them. */
  includeBasicCatalog?: boolean;
}

/**
 * Build a {@link CopilotA2UICatalog} from zod definitions and Angular components.
 * Without `includeBasicCatalog` the catalog contains exactly what you
 * register, so include any layout primitives the agent should use.
 */
export function createAngularCatalog<D extends A2UICatalogDefinitions>(
  definitions: D,
  components: { [K in keyof D]: Type<unknown> },
  options?: CreateAngularCatalogOptions,
): CopilotA2UICatalog {
  const implementations = Object.entries(definitions).map(
    ([name, definition]): CopilotA2UIComponentImplementation => {
      const component = components[name as keyof D];
      if (!component) {
        throw new Error(
          `Missing Angular component for A2UI catalog entry "${name}"`,
        );
      }
      const schema = definition.description
        ? definition.props.describe(definition.description)
        : definition.props;
      return { name, schema, component };
    },
  );

  return new CopilotA2UICatalog(
    options?.catalogId ?? DEFAULT_CATALOG_ID,
    [
      ...(options?.includeBasicCatalog ? basicComponents : []),
      ...implementations,
    ],
    options?.functions ?? BASIC_FUNCTIONS,
  );
}
