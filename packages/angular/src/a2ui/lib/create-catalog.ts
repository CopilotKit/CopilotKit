import { Type, reflectComponentType } from "@angular/core";
import { FunctionImplementation } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import { basicComponents } from "./basic/catalog";
import { CopilotA2UICatalog } from "./catalog";
import {
  A2UICatalogDefinitions,
  A2UIWebComponent,
  CopilotA2UICatalogEntry,
} from "./types";
import { isWebComponentImplementation } from "./universal";

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
 * Build a {@link CopilotA2UICatalog} from zod definitions and, per entry, an
 * Angular component or a Custom Element (`{ tagName, element }`).
 * Without `includeBasicCatalog` the catalog contains exactly what you
 * register, so include any layout primitives the agent should use.
 */
export function createAngularCatalog<D extends A2UICatalogDefinitions>(
  definitions: D,
  components: { [K in keyof D]: Type<unknown> | A2UIWebComponent },
  options?: CreateAngularCatalogOptions,
): CopilotA2UICatalog {
  const implementations = Object.entries(definitions).map(
    ([name, definition]): CopilotA2UICatalogEntry => {
      const component = components[name as keyof D];
      const schema = definition.description
        ? definition.props.describe(definition.description)
        : definition.props;
      if (typeof component === "function" && reflectComponentType(component)) {
        return { name, schema, component };
      }
      if (isWebComponentImplementation(component)) {
        const { tagName, element } = component;
        return { name, schema, tagName, element };
      }
      throw new Error(
        `A2UI catalog entry "${name}" needs an Angular component or { tagName, element }.`,
      );
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
