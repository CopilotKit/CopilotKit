import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_GEN_UI_INTERRUPT_CONFIG } from "./config";
import type { GenUiInterruptConfig } from "./config";
import { GenUiInterruptDemo } from "./gen-ui-interrupt-demo";

// Loads, on the server, how this integration's agent pauses for the time
// picker, and renders the demo with it.
export default async function GenUiInterruptPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config = await loadIntegrationDemoConfig<GenUiInterruptConfig>(
    integration,
    "gen-ui-interrupt",
  );
  return (
    <GenUiInterruptDemo config={config ?? DEFAULT_GEN_UI_INTERRUPT_CONFIG} />
  );
}
