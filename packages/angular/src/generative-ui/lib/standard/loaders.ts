import { InjectionToken } from "@angular/core";

/**
 * Loads an optional library for a standard component. `null` when the app
 * did not opt in: the component shows its fallback instead. The sub-entries
 * `@copilotkit/angular/generative-ui/chart`, `/map` and `/icons` provide
 * the loaders, so the libraries stay out of apps that do not use them.
 */
export type GenerativeUILibraryLoader = () => Promise<unknown>;

/** Loads `chart.js/auto`. Without it, Chart renders its data as a table. */
export const GENERATIVE_UI_CHART_LOADER =
  new InjectionToken<GenerativeUILibraryLoader | null>(
    "GENERATIVE_UI_CHART_LOADER",
    { factory: () => null },
  );

/** Loads `maplibre-gl`. Without it, Map renders its markers as a list. */
export const GENERATIVE_UI_MAP_LOADER =
  new InjectionToken<GenerativeUILibraryLoader | null>(
    "GENERATIVE_UI_MAP_LOADER",
    { factory: () => null },
  );

/** Loads `lucide` (the icon data). Without it, Icon renders nothing. */
export const GENERATIVE_UI_ICON_LOADER =
  new InjectionToken<GenerativeUILibraryLoader | null>(
    "GENERATIVE_UI_ICON_LOADER",
    { factory: () => null },
  );
