import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { OpenClawAgent } from "@ag-ui/openclaw";
import { handle } from "hono/vercel";

// Gateway operator route used when the browser doesn't supply one.
const DEFAULT_OPERATOR_URL =
  process.env.OPERATOR_URL || "http://localhost:8000/v1/clawg-ui/operator";

// Accept a browser-supplied gateway URL only if it parses as http(s); otherwise
// fall back to the default. This is intentionally light validation for a
// run-it-yourself demo. NOTE: the runtime makes a SERVER-SIDE request to this
// URL, so a PUBLICLY-HOSTED deployment would need real allowlisting to avoid an
// SSRF/open-proxy hole — see the security note in the README.
function resolveOperatorUrl(raw: string | null): string {
  if (!raw) return DEFAULT_OPERATOR_URL;
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:"
      ? raw
      : DEFAULT_OPERATOR_URL;
  } catch {
    return DEFAULT_OPERATOR_URL;
  }
}

// Build the OpenClawAgent PER REQUEST from headers the browser sends (both
// stored in localStorage and attached by <CopilotKit headers={...}>, both
// optional):
//   - `x-openclaw-operator-url` → which gateway to talk to (meta for us; denied
//      below so it is NOT forwarded on to the gateway).
//   - `Authorization: Bearer <token>` → the operator token, passed as
//      `gatewayToken` so @ag-ui/openclaw sends it to the gateway.
const runtime = new CopilotRuntime({
  agents: ({ request }) => {
    const url = resolveOperatorUrl(
      request.headers.get("x-openclaw-operator-url"),
    );
    const auth = request.headers.get("authorization");
    const gatewayToken = auth?.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : undefined;
    return { default: new OpenClawAgent({ url, gatewayToken }) };
  },
  // The URL header only tells US which gateway to build the agent for — don't
  // leak it onward to the gateway.
  forwardHeaders: { deny: ["x-openclaw-operator-url"] },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
