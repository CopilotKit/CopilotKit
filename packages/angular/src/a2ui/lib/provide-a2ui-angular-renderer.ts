import {
  A2UI_RENDERER_CONFIG,
  A2uiRendererService,
  BASIC_FUNCTIONS,
  BasicCatalog,
  BasicCatalogBase,
  type AngularComponentImplementation,
  type RendererConfiguration,
} from "@a2ui/angular/v0_9";
import type { FunctionImplementation } from "@a2ui/web_core/v0_9";
import {
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from "@angular/core";
import type {
  A2UIAngularCatalog,
  A2UIAngularCatalogComponent,
  A2UIAngularCatalogFunction,
} from "./a2ui-angular-catalog";

function toAngularComponentImplementation(
  entry: A2UIAngularCatalogComponent,
): AngularComponentImplementation {
  return {
    name: entry.name,
    component: entry.component,
    schema: entry.schema,
  } as unknown as AngularComponentImplementation;
}

function toFunctionImplementation(
  fn: A2UIAngularCatalogFunction,
): FunctionImplementation {
  return {
    name: fn.name,
    returnType: fn.returnType,
    schema: fn.schema as unknown as FunctionImplementation["schema"],
    execute: (args: Record<string, unknown>) =>
      fn.execute(fn.schema.parse(args)),
  };
}

/**
 * Wires the official A2UI Angular renderer (`@a2ui/angular`) into the
 * application so `CopilotA2UIAngularActivityRenderer` can render surfaces.
 *
 * Without arguments, the standard `BasicCatalog` is registered. With a
 * catalog descriptor, the basic components and functions are extended by the
 * given custom Angular components and functions under the catalog's id, so
 * agents can target the custom catalog while all standard components keep
 * working.
 */
export function provideA2UIAngularRenderer(
  catalog?: A2UIAngularCatalog,
): EnvironmentProviders {
  if (!catalog) {
    return makeEnvironmentProviders([
      {
        provide: A2UI_RENDERER_CONFIG,
        useFactory: (): RendererConfiguration => ({
          catalogs: [inject(BasicCatalog)],
        }),
      },
      A2uiRendererService,
    ]);
  }

  const rendererCatalog = new BasicCatalogBase({
    id: catalog.id,
    extraComponents: catalog.components.map(toAngularComponentImplementation),
    functions: [
      ...BASIC_FUNCTIONS,
      ...(catalog.functions ?? []).map(toFunctionImplementation),
    ],
  });

  const rendererConfig: RendererConfiguration = {
    catalogs: [rendererCatalog],
  };

  return makeEnvironmentProviders([
    { provide: A2UI_RENDERER_CONFIG, useValue: rendererConfig },
    A2uiRendererService,
  ]);
}
