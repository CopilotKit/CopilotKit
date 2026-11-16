import type { AgentConfigDemoSettings } from "@/app/demos/[integration]/agent-config/demo-settings";

// The Microsoft Agent Framework agent reads tone, expertise and response
// length from the run's forwardedProps.
export default {
  readsForwardedProps: true,
} satisfies AgentConfigDemoSettings;
