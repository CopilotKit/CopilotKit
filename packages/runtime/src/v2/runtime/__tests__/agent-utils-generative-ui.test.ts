import { HttpAgent } from "@ag-ui/client";
import { expect, test, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import { GenerativeUIMiddleware } from "../generative-ui";

function setup(generativeUI?: { enabled?: boolean; agents?: string[] }) {
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

const genUICalls = (use: ReturnType<typeof setup>["use"]) =>
  use.mock.calls.filter(([m]) => m instanceof GenerativeUIMiddleware);

test("applies the middleware when the provider forwards a manifest", () => {
  const { use, params } = setup();
  configureAgentForRequest({ ...params, providerGenerativeUIManifest: true });
  expect(genUICalls(use)).toHaveLength(1);
});

test("applies the middleware when the runtime enables it", () => {
  const { use, params } = setup({});
  configureAgentForRequest(params);
  expect(genUICalls(use)).toHaveLength(1);
});

test("does nothing without a manifest or runtime config", () => {
  const { use, params } = setup();
  configureAgentForRequest(params);
  expect(genUICalls(use)).toHaveLength(0);
});

test("explicit enabled: false wins over a forwarded manifest", () => {
  const { use, params } = setup({ enabled: false });
  configureAgentForRequest({ ...params, providerGenerativeUIManifest: true });
  expect(genUICalls(use)).toHaveLength(0);
});

test("respects the agents filter", () => {
  const { use, params } = setup({ agents: ["other"] });
  configureAgentForRequest({ ...params, providerGenerativeUIManifest: true });
  expect(genUICalls(use)).toHaveLength(0);
});
