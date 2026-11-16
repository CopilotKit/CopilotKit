import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_DECLARATIVE_GEN_UI_CONFIG } from "./config";
import type { DeclarativeGenUiConfig } from "./config";
import { DeclarativeGenUiDemo } from "./demo";

// Server entry: reads the integration's settings for this demo, then renders
// the client demo with them.
export default async function DeclarativeGenUiPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config =
    (await loadIntegrationDemoConfig<DeclarativeGenUiConfig>(
      integration,
      "declarative-gen-ui",
    )) ?? DEFAULT_DECLARATIVE_GEN_UI_CONFIG;
  return <DeclarativeGenUiDemo config={config} />;
}
