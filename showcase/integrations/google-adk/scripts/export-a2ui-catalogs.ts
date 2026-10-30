/** Build artifacts from the same catalog objects the browser registers. */
import { mkdirSync, writeFileSync } from "node:fs";
import { extractCatalogComponentSchemas } from "@copilotkit/a2ui-renderer";
import { catalog } from "../src/app/demos/a2ui-fixed-schema/a2ui/catalog";
import { myCatalog } from "../src/app/demos/declarative-gen-ui/a2ui/catalog";

const output = new URL("../src/agents/a2ui_schemas/", import.meta.url);
mkdirSync(output, { recursive: true });
for (const [name, value] of [
  ["flight", catalog],
  ["declarative", myCatalog],
] as const) {
  writeFileSync(
    new URL(`${name}_catalog.generated.json`, output),
    `${JSON.stringify(extractCatalogComponentSchemas(value), null, 2)}\n`,
  );
}
