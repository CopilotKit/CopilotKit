// The google-adk agent compiles the authored flight template from A2UI
// Express or from Direct JSON, and fills it with flight data. The page lets
// the user pick the format, which the agent reads from
// `properties.a2ui.inferenceFormat`.
import type { A2uiFixedSchemaConfig } from "@/app/demos/[integration]/a2ui-fixed-schema/config";

export default {
  formatSelector: "template",
} satisfies A2uiFixedSchemaConfig;
