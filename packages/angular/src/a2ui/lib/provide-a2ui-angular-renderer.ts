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
  DestroyRef,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from "@angular/core";
import { CopilotKit } from "@copilotkit/angular";
import type {
  A2UIAngularCatalog,
  A2UIAngularCatalogComponent,
  A2UIAngularCatalogFunction,
} from "./a2ui-angular-catalog";
import {
  catalogIdToContextEntry,
  catalogToContextEntry,
} from "./a2ui-angular-catalog-context";

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

export interface ProvideA2UIAngularRendererOptions {
  /**
   * If `true` (default), the agent receives the full catalog descriptor
   * (component names, descriptions, and prop schemas as JSON Schema) as an
   * AG-UI context entry.
   *
   * Set to `false` to forward only the catalog id. Use this in production
   * setups where the server resolves the trusted catalog descriptor from its
   * own registry instead of trusting client-supplied metadata.
   */
  sendCatalogDescription?: boolean;
}

/**
 * Wires the official A2UI Angular renderer (`@a2ui/angular`) into the
 * application so `CopilotA2UIAngularActivityRenderer` can render surfaces.
 *
 * Without arguments, the standard `BasicCatalog` is registered. With a
 * catalog descriptor, the basic components and functions are extended by the
 * given custom Angular components and functions under the catalog's id, so
 * agents can target the custom catalog while all standard components keep
 * working. The catalog metadata is additionally registered as an AG-UI
 * context entry (see {@link ProvideA2UIAngularRendererOptions} to restrict
 * it to the catalog id), so agents learn which custom components they may
 * emit.
 */
export function provideA2UIAngularRenderer(
  catalog?: A2UIAngularCatalog,
  options?: ProvideA2UIAngularRendererOptions,
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

  const { sendCatalogDescription = true } = options ?? {};

  return makeEnvironmentProviders([
    { provide: A2UI_RENDERER_CONFIG, useValue: rendererConfig },
    A2uiRendererService,
    provideEnvironmentInitializer(() => {
      const copilotKit = inject(CopilotKit);
      const destroyRef = inject(DestroyRef);
      const entry = sendCatalogDescription
        ? catalogToContextEntry(catalog)
        : catalogIdToContextEntry(catalog.id);
      const contextId = copilotKit.core.addContext(entry);

      destroyRef.onDestroy(() => {
        copilotKit.core.removeContext(contextId);
      });
    }),
  ]);
}
