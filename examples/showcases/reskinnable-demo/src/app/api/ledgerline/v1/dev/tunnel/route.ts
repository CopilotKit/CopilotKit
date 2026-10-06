import { presenterResetEnabled } from "@/lib/presenter";
import { nodeTunnelDeps } from "@/skins/ledgerline/tunnel/node-deps";
import {
  ensureTunnelOnce,
  isLocalRequest,
  portFromHost,
  tunnelStatus,
  TunnelError,
  MCP_PATH,
} from "@/skins/ledgerline/tunnel/tunnel";

/**
 * The public tunnel ChatGPT and Claude reach `/api/ledgerline/mcp` through.
 *
 *   GET  -> { url, mcpUrl, healthy }            what is up right now
 *   POST -> { url, mcpUrl, changed, healthy }   keep it if healthy, else replace it
 *
 * The sidebar Reset button POSTs here after the data reset, because a laptop
 * that slept has usually lost its quick tunnel.
 *
 * LOCAL ONLY: it starts and kills processes, so it answers only a request made
 * to 127.0.0.1 / ::1 on this machine, never one that came in through the tunnel
 * (see `isLocalRequest`). Gated like `dev/reset` besides.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function refuse(req: Request): Response | null {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403, headers: NO_STORE },
    );
  }
  if (!isLocalRequest(req.headers)) {
    return Response.json(
      {
        error: "LOCAL_ONLY",
        message:
          "The tunnel can only be managed from this computer. Open the app at http://127.0.0.1 and press Reset there.",
      },
      { status: 403, headers: NO_STORE },
    );
  }
  return null;
}

function depsFor(req: Request) {
  const fallback = Number(process.env.PORT) || 3000;
  return nodeTunnelDeps(portFromHost(req.headers.get("host"), fallback));
}

const withMcp = (url: string | null) => (url ? `${url}${MCP_PATH}` : null);

export const GET = async (req: Request) => {
  const refused = refuse(req);
  if (refused) return refused;
  const status = await tunnelStatus(depsFor(req));
  return Response.json(
    { ...status, mcpUrl: withMcp(status.url) },
    { headers: NO_STORE },
  );
};

export const POST = async (req: Request) => {
  const refused = refuse(req);
  if (refused) return refused;
  try {
    const result = await ensureTunnelOnce(depsFor(req));
    return Response.json(
      { ...result, mcpUrl: withMcp(result.url) },
      { headers: NO_STORE },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ledgerline] tunnel: ${message}`);
    return Response.json(
      {
        error: err instanceof TunnelError ? "TUNNEL_FAILED" : "TUNNEL_ERROR",
        message,
        url: err instanceof TunnelError ? err.url : null,
        healthy: false,
      },
      { status: 502, headers: NO_STORE },
    );
  }
};
