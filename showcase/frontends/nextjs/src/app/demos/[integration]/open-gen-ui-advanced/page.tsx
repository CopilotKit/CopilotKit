import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_OPEN_GEN_UI_ADVANCED_CONFIG } from "./config";
import type { OpenGenUiAdvancedConfig } from "./config";
import { OpenGenUiAdvancedDemo } from "./demo";

// Server entry: reads the integration's settings for this demo, then
// renders the client demo with them.
export default async function OpenGenUiAdvancedPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config =
    (await loadIntegrationDemoConfig<OpenGenUiAdvancedConfig>(
      integration,
      "open-gen-ui-advanced",
    )) ?? DEFAULT_OPEN_GEN_UI_ADVANCED_CONFIG;
  return <OpenGenUiAdvancedDemo config={config} />;
}
