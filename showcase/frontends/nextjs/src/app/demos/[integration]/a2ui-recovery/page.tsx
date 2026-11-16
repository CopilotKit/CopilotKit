import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_A2UI_RECOVERY_CONFIG } from "./config";
import type { A2uiRecoveryConfig } from "./config";
import { A2uiRecoveryDemo } from "./demo";

// Server entry: reads the integration's settings for this demo, then renders
// the client demo with them.
export default async function A2uiRecoveryPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config =
    (await loadIntegrationDemoConfig<A2uiRecoveryConfig>(
      integration,
      "a2ui-recovery",
    )) ?? DEFAULT_A2UI_RECOVERY_CONFIG;
  return <A2uiRecoveryDemo config={config} />;
}
