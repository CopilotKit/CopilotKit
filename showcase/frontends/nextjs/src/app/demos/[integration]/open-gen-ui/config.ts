/**
 * One integration's settings for the open-gen-ui demo. An integration
 * that needs other values than the defaults exports them from
 * `src/integrations/<slug>/demos/open-gen-ui.ts`.
 */
export interface OpenGenUiConfig {
  /**
   * True when the integration's agent has no system prompt that makes it
   * call `generateSandboxedUi`. The page then puts that instruction at the
   * top of the design skill, so the agent draws instead of answering in
   * plain text.
   */
  instructToolCall: boolean;
}

/** The settings of an integration that has no file for this demo. */
export const DEFAULT_OPEN_GEN_UI_CONFIG = {
  instructToolCall: false,
} satisfies OpenGenUiConfig;
