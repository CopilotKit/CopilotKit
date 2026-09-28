import { expect, test, vi } from "vitest";
import { attachIntelligenceRelay } from "../intelligence-relay.js";

/** Creates a frame and an authenticated transport with inspectable requests. */
function setup() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const child = frame.contentWindow;
  if (!child) throw new Error("Missing test window");
  const post = vi
    .spyOn(child, "postMessage")
    .mockImplementation(() => undefined);
  const request = vi.fn(async () => ({
    status: 200,
    body: { data: ["allowed"] },
  }));
  const onAccessLost = vi.fn();
  const dispose = attachIntelligenceRelay({
    target: window,
    frame,
    origin: "https://intelligence.example",
    request,
    onAccessLost,
  });
  const send = (
    source: Window = child,
    origin = "https://intelligence.example",
    data: unknown = {
      type: "cpki:request",
      version: 1,
      id: "request-1",
      request: { method: "GET", path: "/api/v1/runs" },
    },
  ) =>
    window.dispatchEvent(new MessageEvent("message", { source, origin, data }));
  const cleanup = () => {
    dispose();
    post.mockRestore();
    frame.remove();
  };
  return { child, post, request, onAccessLost, dispose, send, cleanup };
}

test("accepts reads only from the configured frame and exact origin", async () => {
  const view = setup();
  try {
    view.send(window);
    view.send(view.child, "https://attacker.example");
    expect(view.request).not.toHaveBeenCalled();

    view.send();
    await vi.waitFor(() =>
      expect(view.post).toHaveBeenCalledWith(
        {
          type: "cpki:response",
          version: 1,
          id: "request-1",
          status: 200,
          body: { data: ["allowed"] },
        },
        "https://intelligence.example",
      ),
    );
    expect(view.request).toHaveBeenCalledTimes(1);
  } finally {
    view.cleanup();
  }
});

test("invalidates the visible workspace when the runtime denies a read", async () => {
  const view = setup();
  try {
    view.request.mockResolvedValue({ status: 403, body: { data: [] } });

    view.send();

    await vi.waitFor(() => expect(view.onAccessLost).toHaveBeenCalledOnce());
  } finally {
    view.cleanup();
  }
});

test("disconnecting cancels pending reads and suppresses late responses", async () => {
  const view = setup();
  let resolve:
    | ((value: { status: number; body: { data: string[] } }) => void)
    | undefined;
  view.request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  try {
    view.send();
    expect(view.request).toHaveBeenCalled();

    view.dispose();
    resolve?.({ status: 200, body: { data: ["stale"] } });
    await new Promise((done) => setTimeout(done, 0));

    expect(view.post).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("transfers export bytes to the exact iframe without a second structured-clone copy", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const child = frame.contentWindow;
  if (!child) throw new Error("Missing frame");
  const post = vi
    .spyOn(child, "postMessage")
    .mockImplementation(() => undefined);
  const content = new ArrayBuffer(8);
  const dispose = attachIntelligenceRelay({
    target: window,
    frame,
    origin: "https://intelligence.example",
    request: async () => ({
      status: 200,
      body: { content, contentType: "text/csv", metadata: null },
    }),
    onAccessLost: vi.fn(),
  });
  try {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child,
        origin: "https://intelligence.example",
        data: {
          type: "cpki:request",
          version: 1,
          id: "download",
          request: {
            method: "GET",
            path: "/api/v1/exports/10000000-0000-4000-8000-000000000001/content",
          },
        },
      }),
    );
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "download",
          body: { content, contentType: "text/csv", metadata: null },
        }),
        "https://intelligence.example",
        [content],
      ),
    );
  } finally {
    dispose();
    post.mockRestore();
    frame.remove();
  }
});

test("accepts time-window updates only from the exact iframe and validates the window", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const child = frame.contentWindow;
  if (!child) throw new Error("Missing frame");
  const onTimeWindow = vi.fn();
  const dispose = attachIntelligenceRelay({
    target: window,
    frame,
    origin: "https://intelligence.example",
    request: async () => ({ status: 200, body: {} }),
    onAccessLost: vi.fn(),
    onTimeWindow,
  });
  const timeWindow = {
    from: "2026-09-20T08:00:00.000Z",
    to: "2026-09-21T08:00:00.000Z",
    period: "custom",
  };
  try {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child,
        origin: "https://attacker.example",
        data: { type: "cpki:time-window", version: 1, timeWindow },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child,
        origin: "https://intelligence.example",
        data: {
          type: "cpki:time-window",
          version: 1,
          timeWindow: { ...timeWindow, to: timeWindow.from },
        },
      }),
    );
    expect(onTimeWindow).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child,
        origin: "https://intelligence.example",
        data: { type: "cpki:time-window", version: 1, timeWindow },
      }),
    );
    expect(onTimeWindow).toHaveBeenCalledWith(timeWindow);
  } finally {
    dispose();
    frame.remove();
  }
});
