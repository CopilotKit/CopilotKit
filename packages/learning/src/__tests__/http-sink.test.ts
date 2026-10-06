import { afterEach, describe, expect, it, vi } from "vitest";
import { httpSink } from "../http-sink";
import type { LearningBatch } from "../types";

const realFetch = globalThis.fetch;
const realSendBeacon = navigator.sendBeacon;

afterEach(() => {
  globalThis.fetch = realFetch;
  navigator.sendBeacon = realSendBeacon;
});

function createBatch(): LearningBatch {
  return {
    trajectoryId: "traj-1",
    dropped: 0,
    events: [
      {
        type: "CUSTOM",
        name: "page",
        timestamp: 1,
        value: { seq: 1, route: "/" },
      },
    ],
  };
}

describe("httpSink", () => {
  it("POSTs the batch as JSON with keepalive and the extra headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    globalThis.fetch = fetchMock;

    await httpSink("/api/learning-events", {
      headers: { "x-project": "demo" },
    })(createBatch());

    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json", "x-project": "demo" },
      body: JSON.stringify(createBatch()),
    });
  });

  it("rejects when the sink responds with an error status", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 500 }),
    );

    await expect(
      httpSink("/api/learning-events")(createBatch()),
    ).rejects.toThrow("Sink responded with 500");
  });

  it("uses sendBeacon when the page is going away", async () => {
    const beacon = vi.fn<typeof navigator.sendBeacon>(() => true);
    navigator.sendBeacon = beacon;
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    await httpSink("/api/learning-events")(createBatch(), { beacon: true });

    expect(beacon.mock.calls[0]?.[0]).toBe("/api/learning-events");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes its url so the collector never captures its own requests", () => {
    expect(httpSink("/api/learning-events").url).toBe("/api/learning-events");
  });
});
