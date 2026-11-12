"use client";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import { demoDefinitions } from "./definitions";
import type { DemoDefinitions } from "./definitions";

const renderers: CatalogRenderers<DemoDefinitions> = {
  Row: ({ props, children }) => <div>{children(props.children[0])}</div>,
  DataTable: ({ props }) => <table>{props.rows.length}</table>,
  FlightCard: ({ props, dispatch }) => (
    <button onClick={() => dispatch(props.action)}>{props.airline}</button>
  ),
};

export const demoCatalog = createCatalog(demoDefinitions, renderers, {
  catalogId: "demo",
  includeBasicCatalog: true,
});
