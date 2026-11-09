import { provide } from "vue";
import type { App } from "vue";
import { GENERATIVE_UI_CHART_LOADER } from "../generative-ui/standard/loaders";

/** One loader for every app, so all charts share one chart.js import. */
const loadChartJs = () => import("chart.js/auto");

/**
 * Experimental. A Vue plugin that draws the standard `Chart` component with
 * chart.js. chart.js loads in its own chunk the first time a chart renders.
 * Without this plugin, Chart shows its data as a table. Add `chart.js` to
 * the app.
 *
 * @example
 * ```ts
 * import { createApp } from "vue";
 * import { GenerativeUIChart } from "@copilotkit/vue/v2/generative-ui/chart";
 *
 * createApp(App).use(GenerativeUIChart).mount("#app");
 * ```
 */
export const GenerativeUIChart = {
  install(app: App) {
    app.provide(GENERATIVE_UI_CHART_LOADER, loadChartJs);
  },
};

/**
 * Experimental. Draws the standard `Chart` components below this component
 * with chart.js, like the `GenerativeUIChart` plugin does for the whole app.
 * Call it in the `setup` of a component, for example the page that shows the
 * chat. Add `chart.js` to the app.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { provideGenerativeUIChart } from "@copilotkit/vue/v2/generative-ui/chart";
 *
 * provideGenerativeUIChart();
 * </script>
 * ```
 */
export function provideGenerativeUIChart() {
  provide(GENERATIVE_UI_CHART_LOADER, loadChartJs);
}
