// ---------------------------------------------------------------------------
// tkt-reasoning-events: Reasoning events not received via agent.subscribe()
//
// Uses BuiltInAgent with o4-mini (a reasoning model) so the AI SDK's
// streamText emits reasoning-start/delta/end parts. BuiltInAgent converts
// these to REASONING_* AG-UI events.
//
// The user's frontend code checks deprecated THINKING_TEXT_MESSAGE_* types
// which are never emitted. This server confirms events DO flow when using
// a reasoning-capable model and the correct REASONING_* event types.
//
// Slack: https://copilotkit.slack.com/archives/C09C1BLEPC1/p1772757286099949
// ---------------------------------------------------------------------------

import { BuiltInAgent } from "@copilotkitnext/agent";
import {
  CopilotRuntime,
  createCopilotEndpointSingleRoute,
} from "@copilotkitnext/runtime";

// Use o4-mini — a reasoning model that produces reasoning events.
// GPT-5-Nano (the user's model) does NOT produce reasoning events.
const agent = new BuiltInAgent({
  model: "openai/o4-mini",
  prompt:
    "You are a helpful assistant. Think through problems step by step. " +
    "Always reason carefully before responding.",
  maxSteps: 3,
});

console.log("[tkt-reasoning-events server] BuiltInAgent created with o4-mini (reasoning model)");

const runtime = new CopilotRuntime({
  agents: { default: agent },
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/",
});

console.log("[tkt-reasoning-events server] Endpoint ready at /api/tickets/tkt-reasoning-events/copilot");

export const handler = (request: Request) => {
  const url = new URL(request.url);
  console.log("[tkt-reasoning-events server] Incoming:", request.method, url.pathname);
  url.pathname = "/";
  return app.fetch(new Request(url, request));
};
