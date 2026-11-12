"use client";

// The `@copilotkit/react-core/generative-ui/map` entry. It is the only module
// that imports `maplibre-gl`, so an app that does not import this entry
// builds without the package.
import type { GenerativeUILibraryLoader } from "./runtime-context";

/**
 * Experimental. Draws the standard `Map` component with MapLibre GL. The
 * library loads in its own chunk the first time a map renders. Without it,
 * Map shows its markers as a list. Add `maplibre-gl` to the app.
 *
 * Map adds the few maplibre-gl styles that markers and popups need, so the
 * app does not import `maplibre-gl.css`.
 *
 * @example
 * ```tsx
 * import { standardUI } from "@copilotkit/react-core/generative-ui";
 * import { loadMapLibre } from "@copilotkit/react-core/generative-ui/map";
 *
 * <CopilotKitProvider generativeUI={{ ui: standardUI, map: loadMapLibre }} />
 * ```
 */
export const loadMapLibre: GenerativeUILibraryLoader = () =>
  import("maplibre-gl");

export type { GenerativeUILibraryLoader } from "./runtime-context";
