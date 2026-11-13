import { createCatalog } from "@copilotkit/a2ui-renderer";

/** Ledgerline emits no a2ui surface; its in-chat visuals are tool renders. */
export const ledgerlineCatalog = createCatalog(
  {},
  {},
  { catalogId: "ledgerline", includeBasicCatalog: false },
);
