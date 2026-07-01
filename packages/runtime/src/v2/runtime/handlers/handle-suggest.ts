import type { Message } from "@ag-ui/client";
import type { CopilotRuntimeLike } from "../core/runtime";
import {
  cloneAgentForRequest,
  configureAgentForRequest,
  parseRunRequest,
} from "./shared/agent-utils";

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
 * create/persist a thread, take a lock, hit the gateway, or attach Intelligence
 * enterprise-learning tools — dynamic suggestions must be side-effect-free in
 * every runtime mode.
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

  configureAgentForRequest({ runtime, request, agentId, agent });

  agent.setMessages(input.messages);
  agent.setState(input.state);
  agent.threadId = input.threadId;

  // Seed with the request messages so a run that emits nothing still returns a
  // coherent transcript; `onMessagesChanged` overwrites this with the running
  // set (which carries the `copilotkitSuggest` tool call the client parses).
  let messages: Message[] = input.messages ?? [];

  try {
    await agent.runAgent(input, {
      onMessagesChanged: ({ messages: next }) => {
        messages = [...next];
      },
    });
  } catch (error) {
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
