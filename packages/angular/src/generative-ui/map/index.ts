import { makeEnvironmentProviders } from "@angular/core";
import type { EnvironmentProviders } from "@angular/core";
import { GENERATIVE_UI_MAP_LOADER } from "@copilotkit/angular/generative-ui";

/**
 * Experimental. Draws the standard `Map` component with MapLibre GL, which
 * loads in its own chunk the first time a map renders. Without this
 * provider, Map shows its markers as a list. Add `maplibre-gl` to the app.
 *
 * @example
 * ```ts
 * providers: [provideGenerativeUI({ ui: standardUI }), provideGenerativeUIMap()]
 * ```
 */
export function provideGenerativeUIMap(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: GENERATIVE_UI_MAP_LOADER,
      useValue: () => import("maplibre-gl"),
    },
  ]);
}
