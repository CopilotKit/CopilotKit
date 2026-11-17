import type { A2UIFormatSelector } from "../_shared/a2ui-format-frame";
import type { SalesCatalogProtocol } from "../_shared/a2ui-sales-dashboard/catalog";

/**
 * One integration's settings for this demo: the default export of
 * `src/integrations/<slug>/demos/declarative-gen-ui.ts`. An integration
 * without that file uses `DEFAULT_DECLARATIVE_GEN_UI_CONFIG`.
 */
export interface DeclarativeGenUiConfig {
  /**
   * The A2UI protocol version of the catalog. It must match the operations
   * that the agent generates.
   */
  catalogProtocol: SalesCatalogProtocol;
  /**
   * `"inference"` shows a selector for the A2UI inference format (A2UI
   * Express or Direct JSON) above the chat. The choice reaches the agent as
   * `properties.a2ui.inferenceFormat`, so use it only for an agent that reads
   * it.
   */
  formatSelector: Exclude<A2UIFormatSelector, "template">;
}

/** The settings of an integration that has no file for this demo. */
export const DEFAULT_DECLARATIVE_GEN_UI_CONFIG = {
  catalogProtocol: "v0.9",
  formatSelector: "none",
} satisfies DeclarativeGenUiConfig;
