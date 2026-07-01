import type { AbstractAgent, Message } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "../core/runtime";
import { extractForwardableHeaders } from "./header-utils";
import { cloneAgentForRequest, parseRunRequest } from "./shared/agent-utils";

/**
 * Parameters for {@link handleSuggestAgent}.
 */
interface SuggestAgentParameters {
  /** The runtime whose registry the agent is resolved from. */
  runtime: CopilotRuntimeLike;
  /** The incoming `POST /agent/:agentId/suggest` request. */
  request: Request;
  /** The route-resolved agent id to run. */
  agentId: string;
}

/**
 * Stateless suggestion run.
 *
 * Executes the provider agent **directly** (via `agent.runAgent`) and returns
 * the resulting messages for the client to parse. It deliberately does not go
 * through `runtime.runner`: `InMemoryAgentRunner.run()` writes to a
 * module-level store keyed by threadId (backing the SSE runtime's local thread
 * endpoints), which would leak the throwaway suggestion thread. Nor does it
 * create/persist a thread, take a lock, or hit the gateway — dynamic
 * suggestions must be side-effect-free in every runtime mode.
 *
 * The only per-request configuration it applies is forwarding the request's
 * allowlisted headers (`authorization` + `x-*`) onto the agent clone. It does
 * **not** attach any request middleware — no A2UI, no MCPApps, no
 * OpenGenerativeUI, no Intelligence enterprise-learning tools. The **client**
 * (the core suggestion engine) forces `toolChoice: copilotkitSuggest` in the
 * request body; this handler does not set tool choice itself and relies on it
 * being present in the incoming `input`. Given that forced tool choice, any
 * middleware-injected tools are dead weight, and MCPApps setup can incur a
 * `listTools`
 * network round-trip per suggestion under `available: "always"` — a side effect
 * this path must never pay.
 *
 * When the client aborts the HTTP request (via its `AbortController`), the
 * server-side run is cancelled best-effort so an aborted suggestion does not
 * keep running a provider call to completion.
 *
 * @param params - The runtime, request, and resolved agent id.
 * @returns A JSON `Response` of shape `{ messages }` on success, the resolution
 *   `Response` (e.g. 404/400) when agent/body resolution fails, or a 502 when
 *   the agent run itself throws.
 */
export async function handleSuggestAgent({
  runtime,
  request,
  agentId,
}: SuggestAgentParameters): Promise<Response> {
  const agent = await cloneAgentForRequest(runtime, agentId, request);
  if (agent instanceof Response) {
    return agent;
  }

  // Carry the registry key onto the clone so any framework relying on it during
  // the run sees the correct agentId.
  agent.agentId = agentId;

  const input = await parseRunRequest(request);
  if (input instanceof Response) {
    return input;
  }

  // Forward only the allowlisted request headers onto the clone. Unlike a full
  // agent run, the suggest path intentionally attaches no middleware (see the
  // handler docblock): the forced `copilotkitSuggest` tool choice makes any
  // middleware-injected tools dead weight, and MCPApps setup can trigger a
  // `listTools` network round-trip we must never incur per suggestion.
  //
  // `AbstractAgent` doesn't declare `headers` on its base type (concrete
  // framework agents add it), so narrow to the header-carrying shape rather
  // than casting to `any`.
  const headerCarryingAgent = agent as AbstractAgent & {
    headers?: Record<string, string>;
  };
  headerCarryingAgent.headers = {
    ...headerCarryingAgent.headers,
    ...extractForwardableHeaders(request),
  };

  agent.setMessages(input.messages);
  agent.setState(input.state);
  agent.threadId = input.threadId;

  // Cancel the server-side run when the client aborts the request, so an
  // aborted suggestion does not keep running a provider call to completion.
  // Best-effort: the listener must never throw. Read `request.signal` once —
  // the accessor can return a fresh reference per read.
  const signal = request.signal;
  if (signal && typeof agent.abortRun === "function") {
    signal.addEventListener(
      "abort",
      () => {
        try {
          agent.abortRun();
        } catch {
          // best-effort — nothing actionable if aborting the run fails.
        }
      },
      { once: true },
    );
  }

  // Seed with the request messages — which include the client's
  // instruction/marker message (id === threadId === suggestionId) as the last
  // entry — so a run that emits nothing still returns a coherent transcript;
  // `onMessagesChanged` overwrites this with the running set (which carries the
  // `copilotkitSuggest` tool call the client parses after the marker).
  let messages: Message[] = input.messages ?? [];

  try {
    await agent.runAgent(input, {
      onMessagesChanged: ({ messages: next }) => {
        messages = [...next];
      },
    });
  } catch (error) {
    // Log server-side before returning the 502 — like every sibling handler —
    // so an operator debugging "suggestions never work in prod" has a trace.
    logger.error({ err: error, agentId }, "Suggestion run failed");
    return Response.json(
      {
        error: "Suggestion run failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  return Response.json(
    { messages },
    { headers: { "Cache-Control": "no-cache" } },
  );
}
