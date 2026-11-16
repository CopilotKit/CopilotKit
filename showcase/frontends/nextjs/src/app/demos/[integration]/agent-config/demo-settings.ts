// How an integration's agent reads the config of this demo. An integration
// whose agent needs other settings than the defaults exports them from
// src/integrations/<slug>/demos/agent-config.ts.

/** One integration's settings for the agent-config demo. */
export interface AgentConfigDemoSettings {
  /**
   * `true` when the agent reads the config from the run's `forwardedProps`.
   * The page then also passes the config as the provider's `properties`.
   * Every agent gets the config as agent context.
   */
  readsForwardedProps: boolean;
}

/** The settings of an integration that has no file for this demo. */
export const DEFAULT_DEMO_SETTINGS: AgentConfigDemoSettings = {
  readsForwardedProps: false,
};
