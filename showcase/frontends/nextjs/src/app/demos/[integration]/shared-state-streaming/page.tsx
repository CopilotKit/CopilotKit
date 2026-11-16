import { loadIntegrationDemoConfig } from "@/lib/demo-config";

import type { SharedStateStreamingConfig } from "./config";
import { SharedStateStreamingDemo } from "./demo";

// Server wrapper: reads this integration's settings for the demo, then
// renders the client demo with them.
export default async function SharedStateStreamingPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config = await loadIntegrationDemoConfig<SharedStateStreamingConfig>(
    integration,
    "shared-state-streaming",
  );
  return (
    <SharedStateStreamingDemo unsupportedNotice={config?.unsupportedNotice} />
  );
}
