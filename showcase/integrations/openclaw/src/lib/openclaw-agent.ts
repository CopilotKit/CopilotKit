import { AbstractAgent } from "@ag-ui/client";
import { OpenClawAgent } from "@ag-ui/openclaw";

// Every demo runtime proxies to the OpenClaw gateway's ag-ui operator route
// (operator-auth: a gateway token, no device pairing). The token stays
// server-side. Client class now lives in @ag-ui/openclaw; only the showcase's
// env wiring remains here.
export const OPERATOR_URL =
  process.env.OPENCLAW_OPERATOR_URL ||
  "http://127.0.0.1:8000/v1/ag-ui/operator";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

// The gateway's liveness endpoint, derived from the operator URL's origin
// (e.g. http://127.0.0.1:8000/health). Used by route health probes.
export const GATEWAY_HEALTH_URL = `${new URL(OPERATOR_URL).origin}/health`;

export function createGatewayAgent(): AbstractAgent {
  return new OpenClawAgent({ url: OPERATOR_URL, gatewayToken: GATEWAY_TOKEN });
}
