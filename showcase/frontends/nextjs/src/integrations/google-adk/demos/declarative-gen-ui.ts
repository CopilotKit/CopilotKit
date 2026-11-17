// ag-ui-adk generates A2UI 1.0 operations for this catalog, and it can stream
// the surface as A2UI Express or as Direct JSON. The page uses the 1.0 catalog
// and lets the user pick the format, which the agent reads from
// `properties.a2ui.inferenceFormat`.
import type { DeclarativeGenUiConfig } from "@/app/demos/[integration]/declarative-gen-ui/config";

export default {
  catalogProtocol: "1.0",
  formatSelector: "inference",
} satisfies DeclarativeGenUiConfig;
