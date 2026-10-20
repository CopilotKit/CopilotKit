import { readJson } from "@/skins/ledgerline/data/http";
import { agentApi } from "@/skins/ledgerline/data/agent-api";

/**
 * The in-app agent's `ledgerlineApi` tool: one call against the integration
 * API, `{ method, path, body }` -> `{ status, body }`. The same dispatcher
 * serves the MCP tool, so in-app and ChatGPT see identical behaviour.
 */
export const POST = async (req: Request) => {
  const { method, path, body } = await readJson(req);
  return Response.json(
    agentApi(String(method ?? ""), String(path ?? ""), body),
  );
};
