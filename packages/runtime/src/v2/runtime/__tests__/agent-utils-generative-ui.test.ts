import { HttpAgent } from "@ag-ui/client";
import { expect, test, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import { GenerativeUIMiddleware } from "../generative-ui";
import { MAX_REJECTED_RENDER_RETRIES } from "../generative-ui/generative-ui-middleware";

type RuntimeOption = boolean | { agents?: string[] } | undefined;
type Transport = "tool" | "markdown" | undefined;

function setup(generativeUI: RuntimeOption) {
  const agent = new HttpAgent({ url: "http://localhost:9999/agent" });
  const runtime = new CopilotRuntime({
    agents: { default: agent },
    generativeUI,
  });
  return {
    use: vi.spyOn(agent, "use"),
    params: {
      runtime,
      agent,
      agentId: "default",
      request: new Request("http://localhost/run"),
    },
  };
}

/** Runs `configureAgentForRequest` and counts the generative UI middlewares it added. */
function genUICount(generativeUI: RuntimeOption, transport: Transport) {
  const { use, params } = setup(generativeUI);
  configureAgentForRequest({
    ...params,
    providerGenerativeUITransport: transport,
  });
  return use.mock.calls.filter(([m]) => m instanceof GenerativeUIMiddleware)
    .length;
}

const cases: [string, RuntimeOption, Transport, number][] = [
  ["adds it for a tool envelope", undefined, "tool", 1],
  ["adds it to every run when the runtime option is true", true, undefined, 1],
  [
    "adds it to every run of the named agents",
    { agents: ["default"] },
    undefined,
    1,
  ],
  [
    "adds nothing without an envelope or a runtime option",
    undefined,
    undefined,
    0,
  ],
  ["adds nothing for a markdown envelope", undefined, "markdown", 0],
  [
    "adds nothing for a markdown envelope, even when the runtime option is true",
    true,
    "markdown",
    0,
  ],
  [
    "adds nothing for a markdown envelope, even for a named agent",
    { agents: ["default"] },
    "markdown",
    0,
  ],
  ["false wins over a tool envelope", false, "tool", 0],
  [
    "respects the agents filter for a tool envelope",
    { agents: ["other"] },
    "tool",
    0,
  ],
];

test.each(cases)("%s", (_case, generativeUI, transport, expected) => {
  expect(genUICount(generativeUI, transport)).toBe(expected);
});

test("a stop reaches the generative UI middleware and still aborts the agent", () => {
  const { use, params } = setup(undefined);
  const abortRun = vi.spyOn(params.agent, "abortRun");
  configureAgentForRequest({
    ...params,
    providerGenerativeUITransport: "tool",
  });
  const middleware = use.mock.calls
    .map(([m]) => m)
    .find((m) => m instanceof GenerativeUIMiddleware);
  const cancelRetries = vi.spyOn(
    middleware as GenerativeUIMiddleware,
    "cancelRetries",
  );
  params.agent.abortRun();
  expect(cancelRetries).toHaveBeenCalledTimes(1);
  expect(abortRun).toHaveBeenCalledTimes(1);
});

test("the runtime's generative UI middleware retries rejected render_ui calls", () => {
  const { use, params } = setup(undefined);
  configureAgentForRequest({
    ...params,
    providerGenerativeUITransport: "tool",
  });
  const middleware = use.mock.calls
    .map(([m]) => m)
    .find((m) => m instanceof GenerativeUIMiddleware);
  // The class defaults to no retry; the runtime opts in beside its stop hook.
  // Element access type-checks private members, so a rename fails tsc.
  expect((middleware as GenerativeUIMiddleware)["maxRejectedRetries"]).toBe(
    MAX_REJECTED_RENDER_RETRIES,
  );
});
