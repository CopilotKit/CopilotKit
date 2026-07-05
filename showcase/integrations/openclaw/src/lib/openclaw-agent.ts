import { HttpAgent, type AbstractAgent } from "@ag-ui/client";

// Local mirror of the `@ag-ui/openclaw` package's `OpenClawAgent` — a thin
// HttpAgent subclass that brands the OpenClaw gateway transport, mirroring how
// every mature integration uses its own `@ag-ui/<framework>` client (e.g. the
// Hermes showcase uses `@ag-ui/hermes`). The canonical package lives at
// `ag-ui/integrations/openclaw`; once it's published, delete this class and
// `import { OpenClawAgent } from "@ag-ui/openclaw"` instead (behaviour is
// identical — the subclass adds no logic; the gateway URL + bearer token stay
// configured here).
class OpenClawAgent extends HttpAgent {}

// Every demo runtime proxies to the OpenClaw gateway's clawg-ui operator route
// (operator-auth: a gateway token, no device pairing). This mirrors the
// claude-sdk-typescript topology — a single pass-through target shared by all
// demo agent ids — but points at the OpenClaw gateway instead of an in-container
// agent server. The token stays server-side.
export const OPERATOR_URL =
  process.env.OPENCLAW_OPERATOR_URL ||
  "http://127.0.0.1:8000/v1/clawg-ui/operator";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

// The gateway's liveness endpoint, derived from the operator URL's origin
// (e.g. http://127.0.0.1:8000/health). Used by route health probes.
export const GATEWAY_HEALTH_URL = `${new URL(OPERATOR_URL).origin}/health`;

export function createGatewayAgent(): AbstractAgent {
  return new OpenClawAgent({
    url: OPERATOR_URL,
    headers: GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {},
  });
}
