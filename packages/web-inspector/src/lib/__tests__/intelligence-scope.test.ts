import { expect, test, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { InspectorIntelligenceView } from "../../components/intelligence-view.js";

/** Supplies a real window object for jsdom's shadow-root iframe. */
async function setup() {
  const view = new InspectorIntelligenceView();
  view.appUrl = "https://intelligence.example/inspector.html";
  view.agentId = "support";
  view.core = new CopilotKitCore({
    runtimeUrl: "https://customer.example/copilot",
  });
  document.body.append(view);
  await view.updateComplete;
  const frame = view.shadowRoot?.querySelector("iframe");
  const context = document.createElement("iframe");
  document.body.append(context);
  const child = context.contentWindow;
  if (!frame || !child) throw new Error("Missing test frame");
  Object.defineProperty(frame, "contentWindow", { value: child });
  const post = vi
    .spyOn(child, "postMessage")
    .mockImplementation(() => undefined);
  const send = (
    source: Window = child,
    origin = "https://intelligence.example",
    version = 1,
  ) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        origin,
        data: { type: "cpki:scope-request", version },
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
      context.remove();
    },
  };
}

test("older embedded apps still receive a changed agent through a fresh URL", async () => {
  const world = await setup();
  try {
    world.view.agentId = "billing";
    await world.view.updateComplete;
    expect(new URL(world.frame.src).searchParams.get("agentId")).toBe(
      "billing",
    );
  } finally {
    world.cleanup();
  }
});

test("only the current child can opt into scope messages and preserve its document", async () => {
  const world = await setup();
  try {
    world.send(window);
    world.send(world.child, "https://attacker.example");
    world.send(world.child, "https://intelligence.example", 2);
    expect(world.post).not.toHaveBeenCalled();
    world.send();
    expect(world.post).toHaveBeenCalledExactlyOnceWith(
      { type: "cpki:agent-scope", version: 1, agentId: "support" },
      "https://intelligence.example",
    );
    const src = world.frame.src;
    world.view.agentId = "billing";
    await world.view.updateComplete;
    expect(world.frame.src).toBe(src);
    expect(world.post).toHaveBeenCalledWith(
      { type: "cpki:agent-scope", version: 1, agentId: "billing" },
      "https://intelligence.example",
    );
    world.post.mockClear();
    world.view.remove();
    world.send();
    expect(world.post).not.toHaveBeenCalled();
  } finally {
    world.cleanup();
  }
});
