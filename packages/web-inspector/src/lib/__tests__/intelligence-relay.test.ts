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
