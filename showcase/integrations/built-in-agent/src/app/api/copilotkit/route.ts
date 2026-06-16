import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import {
  createAgentAliases,
  DEFAULT_BUILT_IN_AGENT_NAMES,
} from "@/lib/factory/agent-aliases";
import {
  createAgenticChatReasoningAgent,
  createReasoningDefaultRenderAgent,
  createToolRenderingReasoningChainAgent,
} from "@/lib/factory/reasoning-factory";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
// `withForwardedHeaders` snapshots inbound x-* headers (e.g.
// x-aimock-context) into an AsyncLocalStorage scope so the wrapped
// OpenAI client's custom fetch can re-attach them on every outbound
// LLM call. Required because `@tanstack/ai-openai`'s `openaiText()`
// adapter has no per-request header hook of its own.
import { withForwardedHeaders } from "@/lib/header-forwarding";

const createHeadlessCompleteAgent = () =>
  createBuiltInAgent({ toolProfile: "headless-complete" });
const createGenUiAgent = () =>
  createBuiltInAgent({ toolProfile: "gen-ui-agent" });
const createHeadlessSimpleAgent = () =>
  createBuiltInAgent({ toolProfile: "headless-simple" });
const createHitlInAppAgent = () =>
  createBuiltInAgent({ toolProfile: "hitl-in-app" });
const createToolRenderingAgent = () =>
  createBuiltInAgent({ toolProfile: "tool-rendering" });
const createSharedStateReadWriteAgent = () =>
  createBuiltInAgent({ toolProfile: "shared-state-read-write" });
const createReadonlyStateAgentContextAgent = () =>
  createBuiltInAgent({ toolProfile: "readonly-state-agent-context" });
const createSubagentsAgent = () =>
  createBuiltInAgent({ toolProfile: "subagents" });

// @region[built-in-agent-runtime]
const runtime = new CopilotRuntime({
  agents: {
    ...createAgentAliases(DEFAULT_BUILT_IN_AGENT_NAMES, createBuiltInAgent),
    ...createAgentAliases(["gen-ui-agent"], createGenUiAgent),
    ...createAgentAliases(["headless-simple"], createHeadlessSimpleAgent),
    ...createAgentAliases(["hitl-in-app"], createHitlInAppAgent),
    ...createAgentAliases(["headless-complete"], createHeadlessCompleteAgent),
    ...createAgentAliases(
      [
        "tool-rendering-default-catchall",
        "tool-rendering-custom-catchall",
        "tool-rendering",
      ],
      createToolRenderingAgent,
    ),
    ...createAgentAliases(
      ["shared-state-read-write"],
      createSharedStateReadWriteAgent,
    ),
    ...createAgentAliases(
      ["readonly-state-agent-context"],
      createReadonlyStateAgentContextAgent,
    ),
    ...createAgentAliases(["subagents"], createSubagentsAgent),
    ...createAgentAliases(
      ["reasoning-custom"],
      createAgenticChatReasoningAgent,
    ),
    ...createAgentAliases(
      ["reasoning-default"],
      createReasoningDefaultRenderAgent,
    ),
    ...createAgentAliases(
      ["tool-rendering-reasoning-chain"],
      createToolRenderingReasoningChainAgent,
    ),
  },
  runner: new InMemoryAgentRunner(),
});
// @endregion[built-in-agent-runtime]

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

async function withProbeCompat(req: Request): Promise<Response> {
  const res = await handler(req);
  if (res.status === 404) {
    const body = await res.text();
    return new Response(body, { status: 400, headers: res.headers });
  }
  return res;
}

export const GET = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
export const POST = (req: Request) =>
  withForwardedHeaders(req, () => withProbeCompat(req));
export const OPTIONS = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
