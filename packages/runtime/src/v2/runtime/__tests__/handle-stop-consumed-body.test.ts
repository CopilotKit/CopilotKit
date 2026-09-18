import { HttpAgent } from "@ag-ui/client";
import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { handleStopAgent } from "../handlers/handle-stop";

test("stop retains its run ID when the identity callback consumes the body", async () => {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "http://localhost:9999",
    wsUrl: "ws://localhost:9999",
    apiKey: "fixture-key",
  });
  const identifyUser = vi.fn(async (request: Request) => {
    await request.json();
    return { id: "alice", name: "Alice" };
  });
  const runtime = new CopilotIntelligenceRuntime({
    intelligence,
    identifyUser,
    agents: { default: new HttpAgent({ url: "http://localhost:9999/agent" }) },
    generateThreadNames: false,
  });
  vi.spyOn(intelligence, "getThread").mockResolvedValue({
    id: "thread-1",
    name: null,
    agentId: "default",
  });
  const stop = vi.spyOn(runtime.runner, "stop").mockResolvedValue(true);
  const response = await handleStopAgent({
    runtime,
    request: new Request("http://localhost/stop", {
      method: "POST",
      body: JSON.stringify({ runId: "run-1" }),
    }),
    agentId: "default",
    threadId: "thread-1",
  });
  expect(response.status).toBe(200);
  expect(identifyUser).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledExactlyOnceWith({
    threadId: "thread-1",
    runId: "run-1",
  });
});
