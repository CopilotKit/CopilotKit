/**
 * One integration's settings for the open-gen-ui-advanced demo. An
 * integration that needs other values than the defaults exports them from
 * `src/integrations/<slug>/demos/open-gen-ui-advanced.ts`.
 */
export interface OpenGenUiAdvancedConfig {
  /**
   * True when the integration's agent has no system prompt that makes it
   * call `generateSandboxedUi`. The page then passes a design skill that
   * says so, and that explains how the generated UI calls the sandbox
   * functions. Without it, such an agent answers in plain text.
   */
  instructToolCall: boolean;
}

/** The settings of an integration that has no file for this demo. */
export const DEFAULT_OPEN_GEN_UI_ADVANCED_CONFIG = {
  instructToolCall: false,
} satisfies OpenGenUiAdvancedConfig;
