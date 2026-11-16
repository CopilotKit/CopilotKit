import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_INTERRUPT_HEADLESS_CONFIG } from "./config";
import type { InterruptHeadlessConfig } from "./config";
import { InterruptHeadlessDemo } from "./interrupt-headless-demo";

// Loads, on the server, how this integration's agent pauses for the time
// picker, and renders the demo with it.
export default async function InterruptHeadlessPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config = await loadIntegrationDemoConfig<InterruptHeadlessConfig>(
    integration,
    "interrupt-headless",
  );
  return (
    <InterruptHeadlessDemo
      config={config ?? DEFAULT_INTERRUPT_HEADLESS_CONFIG}
    />
  );
}
