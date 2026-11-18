import { createCatalog } from "@copilotkit/a2ui-renderer";

/** This app emits no custom components. */
export const emptyCatalog = createCatalog(
  {},
  {},
  { catalogId: "ledger", includeBasicCatalog: false },
);
