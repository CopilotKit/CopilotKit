import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { AgentConfigDemo } from "./agent-config-demo";
import { DEFAULT_DEMO_SETTINGS } from "./demo-settings";
import type { AgentConfigDemoSettings } from "./demo-settings";

// Loads the integration's settings on the server and renders the demo with
// them.
export default async function AgentConfigPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const settings = await loadIntegrationDemoConfig<AgentConfigDemoSettings>(
    integration,
    "agent-config",
  );
  return <AgentConfigDemo settings={settings ?? DEFAULT_DEMO_SETTINGS} />;
}
