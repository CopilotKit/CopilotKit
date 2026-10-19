/**
 * The endpoint index the agent is given for `ledgerlineApi`, client-safe so
 * the in-app tool and the MCP server describe the tool identically. Terse on
 * purpose: endpoint names, no semantics (see `agent-api.ts`).
 */

/** What the agent is told exists. Paths are relative to the API root. */
export const AGENT_API_INDEX = [
  "GET /cards",
  "GET /transactions?card=&status=",
  "GET /transactions/{id}",
  "PATCH /transactions/{id}",
  "GET /receipts?card=&status=",
  "GET /receipts/{id}",
  "POST /reconciliation/sessions",
  "GET /reconciliation/sessions/{id}",
  "POST /reconciliation/sessions/{id}/pairs",
  "DELETE /reconciliation/sessions/{id}/pairs/{transactionId}",
  "POST /reconciliation/sessions/{id}/validate",
  "POST /reconciliation/sessions/{id}/close",
  "GET /reports?status=&employee=",
  "GET /reports/{id}",
  "GET /policies?q=",
  "GET /exports/{id}",
  "POST /webhooks",
] as const;

/** The tool description both surfaces give the agent. */
export const LEDGERLINE_API_DESCRIPTION = [
  "Call Ledgerline's integration API directly. Paths are relative to the API root; send a JSON body where an endpoint takes one. Returns { status, body }.",
  "Endpoints:",
  ...AGENT_API_INDEX.map((e) => `  ${e}`),
].join("\n");
