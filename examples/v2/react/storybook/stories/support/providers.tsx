import React, { useMemo } from "react";
import type { Decorator } from "@storybook/react-vite";
import {
  CopilotKitProvider,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { LicenseContext } from "@copilotkit/react-core/v2/context";
import { StoryAgent } from "./story-agent";
import type { StoryAgentOptions } from "./story-agent";

const StandaloneCopilotKit: React.FC<{
  agent?: StoryAgentOptions;
  children: React.ReactNode;
}> = ({ agent: agentOptions, children }) => {
  const agents = useMemo(
    () => ({ default: new StoryAgent(agentOptions) }),
    [agentOptions],
  );
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={agents}
      enableInspector={false}
    >
      {children}
    </CopilotKitProvider>
  );
};

/**
 * A CopilotKitProvider WITHOUT the global chat configuration. The global
 * decorator pins every story to an explicit thread, and chats bound to an
 * explicit thread never show the welcome screen, so welcome-state stories use
 * this instead. Pair it with `parameters: { copilotkit: false }`.
 */
export const withStandaloneCopilotKit =
  (agent?: StoryAgentOptions): Decorator =>
  (Story) => (
    <StandaloneCopilotKit agent={agent}>
      <Story />
    </StandaloneCopilotKit>
  );

const DefaultToolRenderer: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  useDefaultRenderTool();
  return <>{children}</>;
};

/** Registers CopilotKit's built-in wildcard tool card (`useDefaultRenderTool`). */
export const withDefaultToolRenderer: Decorator = (Story) => (
  <DefaultToolRenderer>
    <Story />
  </DefaultToolRenderer>
);

type LicenseStatus = React.ContextType<typeof LicenseContext>["status"];

/**
 * Pins the license status the runtime would normally report via `/info`, so
 * license-gated UI (e.g. the threads drawer) can be reviewed offline.
 */
export const StoryLicense: React.FC<{
  status: LicenseStatus;
  children: React.ReactNode;
}> = ({ status, children }) => {
  const value = useMemo(
    () => ({
      status,
      license: null,
      checkFeature: () => status === "valid" || status === "expiring",
      getLimit: () => null,
    }),
    [status],
  );
  return (
    <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
  );
};
