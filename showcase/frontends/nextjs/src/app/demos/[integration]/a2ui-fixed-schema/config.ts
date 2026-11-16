import type { A2UIFormatSelector } from "../_shared/a2ui-format-frame";

/**
 * One integration's settings for this demo: the default export of
 * `src/integrations/<slug>/demos/a2ui-fixed-schema.ts`. An integration
 * without that file uses `DEFAULT_A2UI_FIXED_SCHEMA_CONFIG`.
 */
export interface A2uiFixedSchemaConfig {
  /**
   * `"template"` shows a selector for the format that the flight template is
   * compiled from (A2UI Express or Direct JSON). The choice reaches the agent
   * as `properties.a2ui.inferenceFormat`, so use it only for an agent that
   * reads it.
   */
  formatSelector: Exclude<A2UIFormatSelector, "inference">;
}

/** The settings of an integration that has no file for this demo. */
export const DEFAULT_A2UI_FIXED_SCHEMA_CONFIG = {
  formatSelector: "none",
} satisfies A2uiFixedSchemaConfig;
