import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_A2UI_FIXED_SCHEMA_CONFIG } from "./config";
import type { A2uiFixedSchemaConfig } from "./config";
import { A2uiFixedSchemaDemo } from "./demo";

// Server entry: reads the integration's settings for this demo, then renders
// the client demo with them.
export default async function A2uiFixedSchemaPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config =
    (await loadIntegrationDemoConfig<A2uiFixedSchemaConfig>(
      integration,
      "a2ui-fixed-schema",
    )) ?? DEFAULT_A2UI_FIXED_SCHEMA_CONFIG;
  return <A2uiFixedSchemaDemo config={config} />;
}
