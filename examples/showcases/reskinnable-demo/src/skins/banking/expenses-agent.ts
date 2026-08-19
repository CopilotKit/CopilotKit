import { HttpAgent } from "@ag-ui/client";

// SERVER-SAFE. No client directive, no JSX, no React — imported only by
// `src/shell/agent-registry.ts`, never by the client skin module.

/**
 * Banking's long-running offsite-expenses agent.
 *
 * Unlike every other agent in this app it does NOT execute in this process: it
 * is a Python LangChain deep agent (`agent/`) with a sandboxed shell and
 * parallel research subagents, reached over AG-UI. A plain `HttpAgent` is all
 * the wiring it needs, because the runtime's `agents` option is
 * `Record<string, AbstractAgent>` — nothing in the v2 runtime branches on agent
 * class, so every middleware the app already relies on (Intelligence memory via
 * MCP, a2ui surfaces, open-generative-UI) applies to this agent unchanged.
 *
 * Deliberately NOT `LangGraphHttpAgent` from `@copilotkit/runtime/langgraph`:
 * that export lives in the v1 tree (`packages/runtime/src/lib/`) and this app is
 * a v2 app. The Python service speaks native AG-UI, so the generic HTTP client
 * is both sufficient and the correct layer.
 */
export const bankingExpensesAgent = (): HttpAgent =>
  new HttpAgent({
    url: process.env.EXPENSE_AGENT_URL ?? "http://localhost:8124/",
  });
