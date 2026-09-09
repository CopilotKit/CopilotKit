import { HttpAgent } from "@ag-ui/client";
import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime, CopilotSseRuntime } from "../core/runtime";
import {
  CopilotKitIntelligence,
  PlatformRequestError,
} from "../intelligence-platform/client";
import { handleStopAgent } from "../handlers/handle-stop";

/** Create an isolated Intelligence runtime without opening network connections. */
function setup(body?: unknown) {
  const identifyUser = vi.fn(() => ({ id: "alice", name: "Alice" }));
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "http://localhost:9999",
    wsUrl: "ws://localhost:9999",
    apiKey: "fixture-key",
  });
  const runtime = new CopilotIntelligenceRuntime({
    intelligence,
    identifyUser,
    agents: { default: new HttpAgent({ url: "http://localhost:9999/agent" }) },
    generateThreadNames: false,
  });
  const getThread = vi.spyOn(intelligence, "getThread").mockResolvedValue({
    id: "thread-1",
    name: null,
    agentId: "default",
  });
  const stop = vi.spyOn(runtime.runner, "stop").mockResolvedValue(true);
  const request = new Request(
    "http://localhost/copilotkit/agent/default/stop/thread-1",
    {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const invoke = () =>
    handleStopAgent({
      runtime,
      request,
      agentId: "default",
      threadId: "thread-1",
    });
  return { runtime, request, identifyUser, getThread, stop, invoke };
}

test("Intelligence stop rejects invalid identity before accessing or stopping a thread", async () => {
  const { identifyUser, getThread, stop, invoke } = setup();
  identifyUser.mockReturnValue({ id: "", name: "Alice" });

  const response = await invoke();

  expect(response.status).toBe(400);
  expect(getThread).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

test.each([403, 404, 502])(
  "Intelligence stop preserves ownership lookup rejection %s without stopping",
  async (status) => {
    const { getThread, stop, invoke } = setup({ userId: "bob" });
    getThread.mockRejectedValue(
      new PlatformRequestError("upstream-secret", status),
    );

    const response = await invoke();

    expect(response.status).toBe(status);
    expect(getThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: "alice",
    });
    expect(stop).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("upstream-secret");
  },
);

test("Intelligence stop uses the authorized canonical thread and requested run", async () => {
  const { getThread, stop, invoke } = setup({
    runId: "run-current",
    threadId: "spoof",
    userId: "bob",
  });
  getThread.mockResolvedValue({
    id: "canonical-thread",
    name: null,
    agentId: "default",
  });

  const response = await invoke();

  expect(response.status).toBe(200);
  expect(stop).toHaveBeenCalledExactlyOnceWith({
    threadId: "canonical-thread",
    runId: "run-current",
  });
  expect(await response.json()).toMatchObject({ stopped: true });
});

test("Intelligence stop cannot cancel a newer run using a stale run ID", async () => {
  const { stop, invoke } = setup({ runId: "run-stale" });
  stop.mockImplementation(
    async ({ runId }) => runId === undefined || runId === "run-current",
  );

  const response = await invoke();

  expect(response.status).toBe(200);
  expect(stop).toHaveBeenCalledExactlyOnceWith({
    threadId: "thread-1",
    runId: "run-stale",
  });
  expect(await response.json()).toMatchObject({ stopped: false });
});

test.each([
  { body: null },
  { body: [] },
  { body: { runId: "" } },
  { body: { runId: 42 } },
])(
  "Intelligence stop rejects invalid run scope $body before accessing the platform",
  async ({ body }) => {
    const { getThread, stop, invoke } = setup(body);

    const response = await invoke();

    expect(response.status).toBe(400);
    expect(getThread).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  },
);

test("Intelligence stop denies a thread owned by another agent", async () => {
  const { getThread, stop, invoke } = setup();
  getThread.mockResolvedValue({
    id: "thread-1",
    name: null,
    agentId: "different-agent",
  });

  const response = await invoke();

  expect(response.status).toBe(403);
  expect(stop).not.toHaveBeenCalled();
});

test("Intelligence stop rejects missing canonical thread identity", async () => {
  const { getThread, stop, invoke } = setup();
  getThread.mockResolvedValue({ id: "", name: null, agentId: "default" });

  const response = await invoke();

  expect(response.status).toBe(502);
  expect(stop).not.toHaveBeenCalled();
});

test("Intelligence stop still accepts an omitted request body", async () => {
  const { getThread, stop, invoke } = setup();

  const response = await invoke();

  expect(response.status).toBe(200);
  expect(getThread).toHaveBeenCalledExactlyOnceWith({
    threadId: "thread-1",
    userId: "alice",
  });
  expect(stop).toHaveBeenCalledExactlyOnceWith({ threadId: "thread-1" });
});

test("Existing SSE stop keeps its unparsed body and thread-only runner call", async () => {
  const runtime = new CopilotSseRuntime({
    agents: { default: new HttpAgent({ url: "http://localhost:9999/agent" }) },
  });
  const stop = vi.spyOn(runtime.runner, "stop").mockResolvedValue(true);
  const request = new Request("http://localhost/agent/default/stop/thread-1", {
    method: "POST",
    body: "not-json",
  });

  const response = await handleStopAgent({
    runtime,
    request,
    agentId: "default",
    threadId: "thread-1",
  });

  expect(response.status).toBe(200);
  expect(stop).toHaveBeenCalledExactlyOnceWith({ threadId: "thread-1" });
  expect(request.bodyUsed).toBe(false);
});
