import {
  HttpAgent,
  type AbstractAgent,
  type HttpAgentConfig,
} from "@ag-ui/client";

/**
 * Config for {@link OpenClawAgent}. Extends the base HttpAgent config with a
 * first-class `gatewayToken` — the OpenClaw gateway operator token — so callers
 * pass the secret directly instead of hand-assembling an `Authorization` header.
 */
export interface OpenClawAgentConfig extends HttpAgentConfig {
  /**
   * OpenClaw gateway operator token. When set, the agent sends
   * `Authorization: Bearer <gatewayToken>` on every request to the clawg-ui
   * operator route. Omit (or leave empty) to send no auth header.
   */
  gatewayToken?: string;
}

// Local mirror of the `@ag-ui/openclaw` package's `OpenClawAgent` — an HttpAgent
// subclass that brands the OpenClaw gateway transport and takes the gateway
// operator token as a constructor parameter, mirroring how every mature
// integration ships its own `@ag-ui/<framework>` client (e.g. `@ag-ui/mastra`).
// The canonical package lives at `ag-ui/integrations/openclaw`; once it's
// published, delete this class and `import { OpenClawAgent } from
// "@ag-ui/openclaw"` instead.
export class OpenClawAgent extends HttpAgent {
  constructor({ gatewayToken, headers, ...rest }: OpenClawAgentConfig) {
    super({
      ...rest,
      headers: {
        ...headers,
        // The dedicated token param is authoritative for auth: when set it
        // wins over any `Authorization` passed in `headers`.
        ...(gatewayToken
          ? { Authorization: `Bearer ${gatewayToken}` }
          : {}),
      },
    });
  }
}

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
    gatewayToken: GATEWAY_TOKEN,
  });
}
