import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { describe, expect, it, vi } from "vitest";

describe.each(["multi-route", "single-route"] as const)("CopilotKit stop via %s", (mode) => {
  function setup() {
    const runtime = new CopilotRuntime({ agents: { ui: new HttpAgent({ url: "http://unused" }) } });
    const stop = vi.spyOn(runtime.runner, "stop").mockResolvedValue(true);
    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/runtime", mode });
    const request = (body?: unknown) =>
      handler(
        new Request(
          mode === "single-route"
            ? "http://localhost/runtime"
            : "http://localhost/runtime/agent/ui/stop/thread",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            ...(mode === "single-route"
              ? {
                  body: JSON.stringify({
                    method: "agent/stop",
                    params: { agentId: "ui", threadId: "thread" },
                    body,
                  }),
                }
              : body === undefined
                ? {}
                : { body: JSON.stringify(body) }),
          },
        ),
      );
    return { stop, request };
  }

  it("forwards exact runId", async () => {
    const { stop, request } = setup();
    expect((await request({ runId: "run-A" })).status).toBe(200);
    expect(stop).toHaveBeenCalledExactlyOnceWith({ threadId: "thread", runId: "run-A" });
  });

  it("preserves thread-wide stop without a body", async () => {
    const { stop, request } = setup();
    expect((await request()).status).toBe(200);
    expect(stop).toHaveBeenCalledExactlyOnceWith({ threadId: "thread" });
  });

  it("preserves thread-wide stop with an empty object", async () => {
    const { stop, request } = setup();
    expect((await request({})).status).toBe(200);
    expect(stop).toHaveBeenCalledExactlyOnceWith({ threadId: "thread" });
  });

  it.each([{ runID: "run-A" }, { threadId: "other" }, { runId: "run-A", runID: "run-B" }])(
    "rejects unknown stop fields %j without cancelling anything",
    async (body) => {
      const { stop, request } = setup();
      expect((await request(body)).status).toBe(400);
      expect(stop).not.toHaveBeenCalled();
    },
  );

  it.each([null, [], { runId: null }, { runId: 1 }, { runId: "" }])(
    "rejects invalid stop input %j without cancelling anything",
    async (body) => {
      const { stop, request } = setup();
      expect((await request(body)).status).toBe(400);
      expect(stop).not.toHaveBeenCalled();
    },
  );
});
