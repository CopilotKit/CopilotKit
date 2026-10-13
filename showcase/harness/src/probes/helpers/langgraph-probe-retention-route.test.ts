import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupProbeThreadRequest } from "../../../../integrations/_shared/ts/langgraph-probe-retention.js";

afterEach(() => vi.restoreAllMocks());

const threadId = "a4b18d3d-766f-4bb2-8cce-f9085232fc37";
const testId = "d6-langgraph-python-run-1";

function request(): Request {
  return new Request("http://localhost/api/probe-threads", {
    method: "POST",
    body: JSON.stringify({ testId, threadIds: [threadId] }),
  });
}

describe("LangGraph probe retention endpoint", () => {
  it("rejects a null cleanup body without contacting the agent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await cleanupProbeThreadRequest(
      new Request("http://localhost/api/probe-threads", {
        method: "POST",
        body: "null",
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes a completed thread only when its stored probe marker matches", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, options) => {
        if (
          String(url).endsWith(`/threads/${threadId}`) &&
          options?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        return new Response(
          JSON.stringify({
            thread_id: threadId,
            status: "idle",
            metadata: { showcase_probe: true, showcase_probe_id: testId },
          }),
          { status: 200 },
        );
      });

    const response = await cleanupProbeThreadRequest(request());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8123/threads/${threadId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("continues after one thread fails, sweeps, and reports the failure", async () => {
    vi.resetModules();
    const { cleanupProbeThreadRequest: handle } =
      await import("../../../../integrations/_shared/ts/langgraph-probe-retention.js");
    const secondThreadId = "b4b18d3d-766f-4bb2-8cce-f9085232fc37";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, options) => {
        if (String(url).endsWith("/threads/search")) return Response.json([]);
        if (String(url).endsWith(`/threads/${threadId}`))
          return new Response(null, { status: 503 });
        if (options?.method === "DELETE")
          return new Response(null, { status: 204 });
        return Response.json({
          thread_id: secondThreadId,
          status: "idle",
          metadata: { showcase_probe: true, showcase_probe_id: testId },
        });
      });

    const response = await handle(
      new Request("http://localhost/api/probe-threads", {
        method: "POST",
        body: JSON.stringify({ testId, threadIds: [threadId, secondThreadId] }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      deleted: 1,
      expired: 0,
      failures: ["thread read: HTTP 503"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8123/threads/${secondThreadId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/threads/search"),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "another probe",
      { showcase_probe: true, showcase_probe_id: "d6-other-run" },
      "idle",
    ],
    [
      "an interrupted probe",
      { showcase_probe: true, showcase_probe_id: testId },
      "interrupted",
    ],
    [
      "an active probe",
      { showcase_probe: true, showcase_probe_id: testId },
      "busy",
    ],
  ])("preserves %s", async (_case, metadata, status) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          thread_id: threadId,
          status,
          metadata,
        }),
        { status: 200 },
      ),
    );

    const response = await cleanupProbeThreadRequest(request());

    expect(response.status).toBe(200);
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE"),
    ).toBe(false);
  });

  it("expires only old completed probe threads in a bounded sweep", async () => {
    vi.resetModules();
    const { cleanupProbeThreadRequest: handle } =
      await import("../../../../integrations/_shared/ts/langgraph-probe-retention.js");
    const oldThread = {
      thread_id: threadId,
      status: "idle",
      updated_at: "2020-01-01T00:00:00Z",
      metadata: { showcase_probe: true, showcase_probe_id: testId },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, options) => {
        if (String(url).endsWith("/threads/search")) {
          const body = JSON.parse(String(options?.body));
          return Response.json(body.status === "idle" ? [oldThread] : []);
        }
        if (options?.method === "DELETE")
          return new Response(null, { status: 204 });
        return Response.json(oldThread);
      });

    const response = await handle(
      new Request("http://localhost/api/probe-threads", {
        method: "POST",
        body: JSON.stringify({ testId, threadIds: [] }),
      }),
    );

    expect(await response.json()).toEqual({ deleted: 0, expired: 1 });
    expect(
      fetchMock.mock.calls.filter(
        ([, options]) => options?.method === "DELETE",
      ),
    ).toHaveLength(1);
  });
});
