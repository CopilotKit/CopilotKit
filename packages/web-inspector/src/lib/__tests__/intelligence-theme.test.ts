import { expect, test, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { InspectorIntelligenceView } from "../../components/intelligence-view.js";

/** Mounts the existing iframe component and captures its outbound messages. */
async function setup() {
  const view = new InspectorIntelligenceView();
  view.appUrl = "https://intelligence.example/inspector.html";
  view.core = new CopilotKitCore({
    runtimeUrl: "https://customer.example/copilot",
  });
  view.colorScheme = "dark";
  document.body.append(view);
  await view.updateComplete;
  const frame = view.shadowRoot?.querySelector("iframe");
  if (!frame) throw new Error("Missing product frame");
  // jsdom does not create browsing contexts for iframes inside a shadow root.
  const contextFrame = document.createElement("iframe");
  document.body.append(contextFrame);
  const child = contextFrame.contentWindow;
  if (!child) throw new Error("Missing test browsing context");
  Object.defineProperty(frame, "contentWindow", { value: child });
  const post = vi
    .spyOn(child, "postMessage")
    .mockImplementation(() => undefined);
  const send = (source?: Window, origin = "https://intelligence.example") =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: source ?? child,
        origin,
        data: { type: "cpki:theme-request", version: 1 },
      }),
    );
  return {
    view,
    frame,
    child,
    post,
    send,
    cleanup: () => {
      view.remove();
      post.mockRestore();
      contextFrame.remove();
    },
  };
}

test("seeds the host theme and sends changes without reloading the current iframe", async () => {
  const world = await setup();
  try {
    const src = world.frame.src;
    expect(new URL(src).searchParams.get("colorScheme")).toBe("dark");
    world.view.colorScheme = "light";
    await world.view.updateComplete;
    expect(world.view.shadowRoot?.querySelector("iframe")).toBe(world.frame);
    expect(world.frame.src).toBe(src);
    expect(world.post).toHaveBeenCalledWith(
      { type: "cpki:color-scheme", version: 1, colorScheme: "light" },
      "https://intelligence.example",
    );
    world.post.mockClear();
    world.send();
    expect(world.post).toHaveBeenCalledExactlyOnceWith(
      { type: "cpki:color-scheme", version: 1, colorScheme: "light" },
      "https://intelligence.example",
    );
  } finally {
    world.cleanup();
  }
});

test("responds to theme requests only from the current product frame and stops on disconnect", async () => {
  const world = await setup();
  try {
    world.send(window);
    world.send(world.child, "https://attacker.example");
    expect(world.post).not.toHaveBeenCalled();
    world.send();
    expect(world.post).toHaveBeenCalledOnce();
    world.post.mockClear();
    world.view.remove();
    world.send();
    expect(world.post).not.toHaveBeenCalled();
  } finally {
    world.cleanup();
  }
});

test("keeps an in-flight authenticated read alive during a theme change", async () => {
  const world = await setup();
  const core = world.view.core;
  if (!core) throw new Error("Missing core");
  let resolve: ((response: Response) => void) | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const runtimeFetch = Object.getOwnPropertyDescriptor(core, "ɵruntimeFetch");
  Object.defineProperty(core, "ɵruntimeFetch", {
    configurable: true,
    get: () => fetch,
  });
  try {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: world.child,
        origin: "https://intelligence.example",
        data: {
          type: "cpki:request",
          version: 1,
          id: "pending",
          request: { method: "GET", path: "/context" },
        },
      }),
    );
    expect(fetch).toHaveBeenCalledOnce();
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    world.view.colorScheme = "light";
    await world.view.updateComplete;
    expect(signal?.aborted).toBe(false);
    resolve?.(
      new Response(JSON.stringify({ data: ["kept"] }), { status: 200 }),
    );
    await vi.waitFor(() =>
      expect(world.post).toHaveBeenCalledWith(
        {
          type: "cpki:response",
          version: 1,
          id: "pending",
          status: 200,
          body: { data: ["kept"] },
        },
        "https://intelligence.example",
      ),
    );
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    world.cleanup();
    if (runtimeFetch)
      Object.defineProperty(core, "ɵruntimeFetch", runtimeFetch);
    else Reflect.deleteProperty(core, "ɵruntimeFetch");
  }
});
