// Writes agent/canvas_catalog.json: the A2UI 1.0 catalog of the page's
// generative UI (CopilotKit's standard UI minus src/lib/catalog-omit.json).
// The agent's Express path compiles the model's output against it, so run
// this after changing the omit list: `pnpm export:catalog`.
import { readFileSync, writeFileSync } from "node:fs";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";

const omit = JSON.parse(
  readFileSync(
    new URL("../src/lib/catalog-omit.json", import.meta.url),
    "utf8",
  ),
);
const catalog = exportA2UICatalog(standardUI.omit(omit), {
  title: "A2UI canvas",
  description: "CopilotKit's standard components that the canvas demo uses.",
});
const out = new URL("../agent/canvas_catalog.json", import.meta.url);
writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");
console.log(
  `Wrote ${Object.keys(catalog.components).length} components to agent/canvas_catalog.json`,
);
