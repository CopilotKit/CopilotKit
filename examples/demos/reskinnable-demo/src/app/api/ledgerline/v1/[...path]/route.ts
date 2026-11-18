import { agentApi } from "@/skins/ledgerline/data/agent-api";
import { readJson } from "@/skins/ledgerline/data/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * The exception workflows the Card close board calls (allocations, reclass
 * entries, repayments, affidavits, events). The same handler the agent's
 * `ledgerlineApi` reaches, with the board's own origin, so a person's
 * trajectory records exactly the calls a learned skill replays.
 */
async function handle(req: Request, { params }: Ctx) {
  const { path } = await params;
  const url = new URL(req.url);
  const body = req.method === "GET" ? undefined : await readJson(req);
  const out = agentApi(
    req.method,
    `/${path.join("/")}${url.search}`,
    body,
    "board",
  );
  return Response.json(out.body, {
    status: out.status,
    headers: { "cache-control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
