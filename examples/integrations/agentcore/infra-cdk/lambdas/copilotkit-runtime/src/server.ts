// =============================================================================
// ██████████████████████████████████████████████████████████████████████████
// ██                                                                        ██
// ██   ⚠️  LOCAL DEVELOPMENT ONLY — DO NOT DEPLOY ⚠️                       ██
// ██                                                                        ██
// ██   Serves the same CopilotKit app as index.ts (Lambda) but via         ██
// ██   @hono/node-server instead of streamHandle.                          ██
// ██                                                                        ██
// ██   Set AGENTCORE_AG_UI_URL=http://agent:8080/invocations to point     ██
// ██   at the local agent container instead of AWS.                        ██
// ██                                                                        ██
// ██   Production entrypoint: index.ts                                     ██
// ██                                                                        ██
// ██████████████████████████████████████████████████████████████████████████
// =============================================================================

import { serve } from "@hono/node-server";
import { buildApp } from "./runtime";

const PORT = parseInt(process.env.PORT ?? "3001");
const app = buildApp();

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(
    `[local] CopilotKit bridge on :${PORT}  →  ${process.env.AGENTCORE_AG_UI_URL ?? "???"}`,
  );
});
