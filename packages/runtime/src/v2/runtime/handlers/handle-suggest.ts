import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { finalizeRunEvents } from "@copilotkit/shared";
import { Observable } from "rxjs";
import type { CopilotRuntimeLike } from "../core/runtime";
import {
  mergeForwardableHeaders,
  resolveForwardHeadersPolicy,
} from "./header-utils";
import { cloneAgentForRequest, parseRunRequest } from "./shared/agent-utils";
import { createSseEventResponse } from "./shared/sse-response";

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
 * Executes the provider agent **directly** and streams its AG-UI events back as
 * SSE — the same wire format as `/agent/:id/run`, so the client consumes it with
 * the stock `HttpAgent` transport and chips fill in as the provider emits them.
 * It deliberately does not go through `runtime.runner`: the runner's
 * `run()` writes to a module-level store keyed by threadId (backing the SSE
 * runtime's local thread endpoints), which would leak the throwaway suggestion
 * thread. This handler runs the agent's event pipeline **without** that
 * persistence — no thread, lock, gateway, name-gen, or run telemetry — so
 * dynamic suggestions are side-effect-free in every runtime mode.
 *
 * The only per-request configuration it applies is forwarding the request's
 * allowlisted headers (`authorization` + `x-*`) onto the agent clone. It does
 * **not** attach any request middleware — no A2UI, no MCPApps, no
 * OpenGenerativeUI, no Intelligence enterprise-learning tools. The **client**
 * (the core suggestion engine) forces `toolChoice: copilotkitSuggest` in the
 * request body; this handler does not set tool choice itself and relies on it
 * being present in the incoming `input`. Given that forced tool choice, any
 * middleware-injected tools are dead weight, and MCPApps setup can incur a
 * `listTools` network round-trip per suggestion under `available: "always"` — a
 * side effect this path must never pay.
 *
 * When the client aborts the HTTP request (via its `AbortController`), the
 * server-side run is cancelled best-effort so an aborted suggestion does not
 * keep running a provider call to completion.
 *
 * @param params - The runtime, request, and resolved agent id.
 * @returns A `text/event-stream` `Response` of the provider agent's AG-UI events
 *   on success, or the resolution `Response` (e.g. 404/400) when agent/body
 *   resolution fails before streaming begins.
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

  // Forward eligible inbound headers onto the clone under the runtime's resolved
  // forwarding policy (same helper the run handler uses: `authorization` /
  // custom `x-*`, infra/proxy/platform headers denylisted, server-set headers
  // winning on collision — #5712). Unlike a full agent run, the suggest path
  // intentionally attaches no middleware (see the handler docblock): the forced
  // `copilotkitSuggest` tool choice makes any middleware-injected tools dead
  // weight, and MCPApps setup can trigger a `listTools` network round-trip we
  // must never incur per suggestion.
  //
  // `AbstractAgent` doesn't declare `headers` on its base type (concrete
  // framework agents add it), so narrow to the header-carrying shape rather
  // than casting to `any`.
  const headerCarryingAgent = agent as AbstractAgent & {
    headers?: Record<string, string>;
  };
  headerCarryingAgent.headers = mergeForwardableHeaders(
    headerCarryingAgent.headers,
    request,
    runtime.forwardHeadersPolicy ?? resolveForwardHeadersPolicy(undefined),
  );

  agent.setMessages(input.messages);
  agent.setState(input.state);
  agent.threadId = input.threadId;

  // Stream the provider agent's events over SSE without persistence. This is
  // the runner's event pipeline (`agent.runAgent({ onEvent })` + terminal-event
  // finalization) minus the `GLOBAL_STORE` writes that would leak a thread.
  // `captureTelemetry: false` keeps suggestions out of run telemetry; omitting
  // `debugEventBus` keeps them out of the inspector's run trace.
  return createSseEventResponse({
    request,
    agentId,
    captureTelemetry: false,
    observableFactory: () =>
      new Observable<BaseEvent>((subscriber) => {
        // Collected so `finalizeRunEvents` can append any missing terminal
        // events (e.g. an unclosed message/tool call, or a `RUN_FINISHED`) —
        // the same closure the runner applies — so the client sees a
        // well-formed AG-UI sequence.
        const collected: BaseEvent[] = [];
        let settled = false;

        void agent
          .runAgent(input, {
            onEvent: ({ event }) => {
              collected.push(event);
              subscriber.next(event);
            },
          })
          .then(() => {
            for (const event of finalizeRunEvents(collected, {
              stopRequested: false,
            })) {
              subscriber.next(event);
            }
            settled = true;
            subscriber.complete();
          })
          .catch((error: unknown) => {
            settled = true;
            subscriber.error(error);
          });

        // Teardown fires when the response stream is torn down (client abort /
        // disconnect). Cancel the still-running provider call best-effort.
        return () => {
          if (!settled && typeof agent.abortRun === "function") {
            try {
              agent.abortRun();
            } catch {
              // best-effort — nothing actionable if aborting the run fails.
            }
          }
        };
      }),
  });
}
