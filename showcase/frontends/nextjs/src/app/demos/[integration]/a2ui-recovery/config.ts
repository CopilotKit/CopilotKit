import type { A2UIFormatSelector } from "../_shared/a2ui-format-frame";
import type { SalesCatalogProtocol } from "../_shared/a2ui-sales-dashboard/catalog";

/** The messages that the two recovery pills send. */
export interface A2uiRecoveryPrompts {
  /** "Recover a bad render": the first render is invalid, the retry heals it. */
  heal: string;
  /** "Show an unrecoverable failure": every render attempt is invalid. */
  exhaust: string;
}

/**
 * One integration's settings for this demo: the default export of
 * `src/integrations/<slug>/demos/a2ui-recovery.ts`. An integration without
 * that file uses `DEFAULT_A2UI_RECOVERY_CONFIG`.
 */
export interface A2uiRecoveryConfig {
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
  /**
   * The pill messages. They are the keys of the aimock fixtures that force
   * the invalid renders. Most agents send the inner `render_a2ui` call
   * without the X-AIMock-Context header, so those fixtures match every
   * integration. Each integration therefore has its own messages.
   */
  prompts: A2uiRecoveryPrompts;
}

/** The settings of an integration that has no file for this demo. */
export const DEFAULT_A2UI_RECOVERY_CONFIG = {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Build my Q2 revenue summary and self-correct a malformed first attempt.",
    exhaust:
      "Build a report that fails every validation pass so I can preview the fallback.",
  },
} satisfies A2uiRecoveryConfig;
