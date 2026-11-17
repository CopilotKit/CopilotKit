/**
 * One integration's settings for this demo: the default export of
 * `src/integrations/<slug>/demos/shared-state-streaming.ts`.
 *
 * An integration without that file streams the document into state token by
 * token.
 */
export interface SharedStateStreamingConfig {
  /**
   * Why this backend cannot stream the document into state token by token.
   * The empty document panel shows it in place of the usual prompt.
   */
  unsupportedNotice: string;
}
