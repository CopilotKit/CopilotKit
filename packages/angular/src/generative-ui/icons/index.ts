import { makeEnvironmentProviders } from "@angular/core";
import type { EnvironmentProviders } from "@angular/core";
import { GENERATIVE_UI_ICON_LOADER } from "@copilotkit/angular/generative-ui";

/**
 * Experimental. Draws the standard `Icon` component, and the icons of
 * Button and Select, with the Lucide icon set. The `lucide` package (the
 * icon data, not a framework binding) loads in its own chunk the first time
 * an icon renders. Without this provider, icons render nothing. Add
 * `lucide` to the app.
 *
 * @example
 * ```ts
 * providers: [provideGenerativeUI({ ui: standardUI }), provideGenerativeUIIcons()]
 * ```
 */
export function provideGenerativeUIIcons(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: GENERATIVE_UI_ICON_LOADER,
      useValue: () => import("lucide"),
    },
  ]);
}
