import { GenerativeUIChart } from "@copilotkit/vue/generative-ui/chart";

// Turns on the standard Chart component (chart.js). Without this plugin,
// Chart renders its data as a table.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(GenerativeUIChart);
});
