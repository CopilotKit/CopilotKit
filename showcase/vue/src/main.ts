import "@copilotkit/vue/styles.css";
import { createApp } from "vue";

import App from "./App.vue";
import type { BrowserCellCatalog } from "./cell-context";
import { readVueRuntimeConfig } from "./cell-context";
import frontendCatalogData from "./generated/frontend-catalog.json";
import { bootstrapVueHost } from "./host-configuration";
import "./styles.css";

const frontendCatalog: BrowserCellCatalog = frontendCatalogData;
const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("The Vue Showcase mount element is missing.");
}

const resolution = bootstrapVueHost(
  globalThis.location.pathname,
  frontendCatalog,
  readVueRuntimeConfig(),
  (configuration) => {
    createApp(App, { configuration }).mount(root);
    globalThis.performance.mark("copilotkit:showcase-shell-ready");
  },
);

if (resolution.kind !== "ready") {
  root.replaceChildren();
  const panel = document.createElement("main");
  panel.className = "status-page";
  panel.dataset["testid"] = "vue-showcase-unavailable";
  panel.textContent = resolution.reason;
  root.append(panel);
}
