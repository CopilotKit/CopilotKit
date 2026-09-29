import { expect, test, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { attachIntelligenceRelay } from "../intelligence-relay.js";
import { InspectorIntelligenceView } from "../../components/intelligence-view.js";

/** Creates an isolated real iframe and sends untrusted bridge envelopes. */
function setupRelay() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const child = frame.contentWindow;
  if (!child) throw new Error("Missing frame");
  const onChannelScope = vi.fn();
  const dispose = attachIntelligenceRelay({
    target: window,
    frame,
    origin: "https://intelligence.example",
    request: async () => ({ status: 200, body: {} }),
    onAccessLost: vi.fn(),
    onChannelScope,
  });
  return {
    onChannelScope,
    send: (
      channel: unknown,
      source: Window = child,
      origin = "https://intelligence.example",
    ) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: { type: "cpki:channel-scope", version: 1, channel },
        }),
      ),
    cleanup: () => {
      dispose();
      frame.remove();
    },
  };
}

test("channel updates accept only known values from the exact iframe", () => {
  const world = setupRelay();
  try {
    world.send("slack", window);
    world.send("slack", undefined, "https://attacker.example");
    for (const channel of ["email", null, {}, 1, "*", undefined])
      world.send(channel);
    expect(world.onChannelScope).not.toHaveBeenCalled();

    for (const channel of ["slack", "teams", "web", "not_captured", ""])
      world.send(channel);

    expect(world.onChannelScope.mock.calls).toEqual([
      ["slack"],
      ["teams"],
      ["web"],
      ["not_captured"],
      [""],
    ]);
  } finally {
    world.cleanup();
  }
});

test("channel selection reaches the next pane without reloading the active iframe", async () => {
  const view = new InspectorIntelligenceView();
  view.appUrl = "https://intelligence.example/inspector.html";
  view.core = new CopilotKitCore({
    runtimeUrl: "https://customer.example/copilot",
  });
  document.body.append(view);
  try {
    await view.updateComplete;
    const original = view.shadowRoot?.querySelector("iframe")?.src;
    view.channel = "slack";
    view.requestUpdate();
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector("iframe")?.src).toBe(original);

    view.section = "governance";
    await view.updateComplete;

    expect(
      new URL(view.shadowRoot!.querySelector("iframe")!.src).searchParams.get(
        "channel",
      ),
    ).toBe("slack");
    view.channel = "";
    view.section = "learning";
    await view.updateComplete;
    expect(
      new URL(view.shadowRoot!.querySelector("iframe")!.src).searchParams.has(
        "channel",
      ),
    ).toBe(false);
  } finally {
    view.remove();
  }
});
