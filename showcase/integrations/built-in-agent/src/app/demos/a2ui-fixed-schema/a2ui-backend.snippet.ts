// Docs-only snippet — not imported or run. The shell-docs page at
// `/generative-ui/a2ui/fixed-schema` references the regions
// `backend-schema-json-load` and `backend-render-operations` to teach
// the *schema-inline* pattern for built-in-agent (the schema is declared
// as a typed literal in source rather than loaded from JSON at startup).
// This file exposes those regions as canonical teaching code so the docs
// render real samples instead of a missing-snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

// @region[backend-render-operations]
// @region[backend-schema-json-load]
declare const a2ui: {
  createSurface: (id: string, opts: { catalogId: string }) => unknown;
  updateComponents: (id: string, schema: unknown) => unknown;
  updateDataModel: (id: string, data: Record<string, unknown>) => unknown;
  render: (args: { operations: unknown[] }) => unknown;
};
const SURFACE_ID = "flight-fixed-schema";
const CATALOG_ID = "flight-catalog";

// In the schema-inline pattern, the schema is declared as a typed literal
// in source rather than loaded from JSON at startup. Same shape as the
// schema-loading variant; just no file I/O.
const FLIGHT_SCHEMA = [
  {
    type: "Card",
    children: [
      { type: "Title", text: "Flight" },
      {
        type: "Row",
        children: [
          { type: "Label", bind: "origin" },
          { type: "Label", bind: "destination" },
        ],
      },
      {
        type: "Row",
        children: [
          { type: "Label", bind: "airline" },
          { type: "Label", bind: "price" },
        ],
      },
    ],
  },
];
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
