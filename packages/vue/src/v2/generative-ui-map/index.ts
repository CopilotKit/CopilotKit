import type { Plugin } from "vue";
import { GENERATIVE_UI_MAP_LOADER } from "../generative-ui/standard/loaders";

/**
 * Experimental. Draws the standard `Map` component with MapLibre GL. The
 * library loads in its own chunk the first time a map renders. Without this
 * plugin, Map shows its markers as a list. Add `maplibre-gl` to the app.
 *
 * Map adds the few maplibre-gl styles that markers and popups need, so the
 * app does not import `maplibre-gl.css`.
 *
 * @example
 * ```ts
 * import { GenerativeUIMap } from "@copilotkit/vue/v2/generative-ui/map";
 *
 * createApp(App).use(GenerativeUIMap).mount("#app");
 * ```
 */
export const GenerativeUIMap: Plugin = {
  install(app) {
    app.provide(GENERATIVE_UI_MAP_LOADER, () => import("maplibre-gl"));
  },
};
