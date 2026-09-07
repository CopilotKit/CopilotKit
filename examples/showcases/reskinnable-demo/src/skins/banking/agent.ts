import { HttpAgent } from "@ag-ui/client";

// SERVER-SAFE. No client directive, no JSX, no React — imported only by
// `src/shell/agent-registry.ts`, never by the client skin module.

/**
 * Banking's agent. THE ONE SKIN IN THIS APP WHOSE AGENT IS NOT A
 * `BuiltInAgent` — it does not execute in this process at all. It is a Python
 * LangChain deep agent (`agent/`) with a sandboxed shell and parallel research
 * subagents, reached over AG-UI.
 *
 * ## Why banking, and why the whole agent
 *
 * The offsite-expenses beat is a multi-minute agentic run: read a personal card
 * statement, research every merchant, decide what the offsite makes
 * reimbursable, file the charges, return a report card. A `defineTool` cannot
 * express it — `execute` takes `(args)` and returns a value, with no way to emit
 * events, so the whole journey would be invisible until the tool returned.
 *
 * The reason the ENTIRE agent moved, rather than just that one beat, is the
 * thread rail. Threads are scoped per agent — `listThreads` takes `agentId` as a
 * REQUIRED parameter, and the runtime's architecture notes are explicit that
 * "each agent gets its own endpoint, message thread, state". Running the
 * expenses beat under a second agent id put it in a second thread list, so a
 * presenter could start the analysis, switch threads, and have nothing to come
 * back to. One conversation list means one agent.
 *
 * ## Why this is a plain `HttpAgent`
 *
 * `CopilotRuntime`'s `agents` option is `Record<string, AbstractAgent>` and the
 * v2 runtime contains no `instanceof BuiltInAgent` branch anywhere, so every
 * mechanism the demo relies on reaches a remote agent unchanged. Measured, not
 * assumed: a run against this agent binds the browser's frontend tools AND the
 * Intelligence MCP tools (`recall_memory`, `save_memory`, `forget_memory`), the
 * a2ui middleware turns its `render_report` result into a canvas surface, and a
 * human-in-the-loop tool call round-trips (call out, answer back, agent
 * continues).
 *
 * Deliberately NOT `LangGraphHttpAgent` from `@copilotkit/runtime/langgraph`:
 * that export lives in the v1 tree (`packages/runtime/src/lib/`) and this app is
 * a v2 app. The Python service speaks native AG-UI, so the generic HTTP client
 * is both sufficient and the correct layer.
 *
 * ## Operational consequence
 *
 * Banking now needs the `agent/` service running. Every other skin still runs
 * in-process, so a dead Python container takes banking down and leaves the other
 * six working — check `docker compose ps` / the service's `/health` before
 * blaming the runtime.
 */
export const bankingAgent = (): HttpAgent =>
  new HttpAgent({
    url: process.env.BANKING_AGENT_URL ?? "http://localhost:8124/",
  });
