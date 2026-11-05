import {
  HttpAgent,
  type RunAgentParameters,
  type RunAgentResult,
} from "@ag-ui/client";
import { afterEach, expect, it, vi } from "vitest";
import { bindMcpApp } from "../session";
import { mcpAppsRequestQueue } from "../request-queue";

class ResourceAgent extends HttpAgent {
  readonly read = vi.fn(
    async (_parameters: RunAgentParameters): Promise<RunAgentResult> => ({
      result: {
        contents: [
          { uri: "ui://test/app", mimeType: "text/html", text: "<p>Ready</p>" },
        ],
      },
      newMessages: [],
    }),
  );
  ɵrunMcpResourceRead(parameters: RunAgentParameters) {
    return this.read(parameters);
  }
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});
function bind(agent: HttpAgent) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const resource = vi.fn();
  const error = vi.fn();
  const session = bindMcpApp({
    iframe,
    getAgent: () => agent,
    getContent: () => ({
      resourceUri: "ui://test/app",
      serverHash: "trusted-server",
      toolInput: {},
      result: { content: [] },
    }),
    host: { runAgent: async () => ({ result: undefined, newMessages: [] }) },
    hooks: { onResource: resource, onError: error },
    options: { idleTimeoutMs: 50 },
  });
  cleanups.push(() => {
    session.teardown();
    iframe.remove();
  });
  return { session, resource, error };
}
it("loads an isolated resource while the conversation and mutation queue remain busy", async () => {
  const agent = new ResourceAgent({
    url: "https://runtime.example",
    threadId: "original",
  });
  agent.isRunning = true;
  const owner = {};
  const mutation = vi.fn(async () => ({ result: {}, newMessages: [] }));
  const queued = mcpAppsRequestQueue.enqueue(agent, mutation, { owner });
  const cancellation = expect(queued).rejects.toThrow("cancelled");
  cleanups.push(() => mcpAppsRequestQueue.cancelOwner(owner));
  const { resource } = bind(agent);
  await vi.waitFor(() => expect(resource).toHaveBeenCalledOnce(), {
    timeout: 150,
  });
  expect(agent.read).toHaveBeenCalledOnce();
  expect(mutation).not.toHaveBeenCalled();
  expect(agent.isRunning).toBe(true);
  mcpAppsRequestQueue.cancelOwner(owner);
  await cancellation;
});

it("keeps agents without the isolated helper on the ordinary busy-agent queue", async () => {
  const agent = new HttpAgent({
    url: "https://runtime.example",
    threadId: "original",
  });
  agent.isRunning = true;
  const run = vi
    .spyOn(agent, "runAgent")
    .mockResolvedValue({ result: {}, newMessages: [] });
  const { resource, error } = bind(agent);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce(), {
    timeout: 200,
  });
  expect(error.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      message: expect.stringContaining("Timed out waiting"),
    }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(resource).not.toHaveBeenCalled();
});
