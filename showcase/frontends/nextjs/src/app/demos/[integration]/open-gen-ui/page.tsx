import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_OPEN_GEN_UI_CONFIG } from "./config";
import type { OpenGenUiConfig } from "./config";
import { OpenGenUiDemo } from "./demo";

// Server entry: reads the integration's settings for this demo, then
// renders the client demo with them.
export default async function OpenGenUiPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config =
    (await loadIntegrationDemoConfig<OpenGenUiConfig>(
      integration,
      "open-gen-ui",
    )) ?? DEFAULT_OPEN_GEN_UI_CONFIG;
  return <OpenGenUiDemo config={config} />;
}
