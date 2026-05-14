// Docs-only snippet — not imported or run. The shell-docs page at
// `/generative-ui/a2ui/fixed-schema` references the regions
// `backend-schema-json-load` and `backend-render-operations` to teach
// the schema-loading pattern. This file exposes those regions as
// canonical teaching code so the docs render real samples instead of a
// missing-snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

// @region[backend-render-operations]
// @region[backend-schema-json-load]
import path from "path";
import fs from "fs";

const SCHEMAS_DIR = path.join(__dirname, "a2ui_schemas");

// Stand-in for the real a2ui SDK helpers. In a real backend, import
// `a2ui` from your runtime SDK.
declare const a2ui: {
  loadSchema: (path: string) => unknown;
  createSurface: (id: string, opts: { catalogId: string }) => unknown;
  updateComponents: (id: string, schema: unknown) => unknown;
  updateDataModel: (id: string, data: Record<string, unknown>) => unknown;
  render: (args: { operations: unknown[] }) => unknown;
};
const SURFACE_ID = "flight-fixed-schema";
const CATALOG_ID = "flight-catalog";

// Schemas are JSON so they can be authored and reviewed independently of
// the backend code. `a2ui.loadSchema` is a thin wrapper around
// `JSON.parse(fs.readFileSync(...))` that resolves the path against the
// schemas directory.
const FLIGHT_SCHEMA = a2ui.loadSchema(
  path.join(SCHEMAS_DIR, "flight_schema.json"),
);
// @endregion[backend-schema-json-load]

export function emitRenderOperations(args: {
  origin: string;
  destination: string;
  airline: string;
  price: number;
}) {
  // The a2ui middleware detects the `a2ui_operations` container in this
  // tool result and forwards the ops to the frontend renderer. The
  // frontend catalog resolves component names to local React components.
  return a2ui.render({
    operations: [
      a2ui.createSurface(SURFACE_ID, { catalogId: CATALOG_ID }),
      a2ui.updateComponents(SURFACE_ID, FLIGHT_SCHEMA),
      a2ui.updateDataModel(SURFACE_ID, {
        origin: args.origin,
        destination: args.destination,
        airline: args.airline,
        price: args.price,
      }),
    ],
  });
  // @endregion[backend-render-operations]
}
