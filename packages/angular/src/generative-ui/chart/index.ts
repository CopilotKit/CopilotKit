import { makeEnvironmentProviders } from "@angular/core";
import type { EnvironmentProviders } from "@angular/core";
import { GENERATIVE_UI_CHART_LOADER } from "@copilotkit/angular/generative-ui";

/**
 * Experimental. Draws the standard `Chart` component with chart.js, which
 * loads in its own chunk the first time a chart renders. Without this
 * provider, Chart shows its data as a table. Add `chart.js` to the app.
 *
 * @example
 * ```ts
 * providers: [provideGenerativeUI({ ui: standardUI }), provideGenerativeUIChart()]
 * ```
 */
export function provideGenerativeUIChart(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: GENERATIVE_UI_CHART_LOADER,
      useValue: () => import("chart.js/auto"),
    },
  ]);
}
