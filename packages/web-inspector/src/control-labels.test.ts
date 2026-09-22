import { afterEach, expect, test, vi } from "vitest";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";

import {
  INSPECTOR_LEARNING_LABEL,
  INSPECTOR_THREADS_LABEL,
} from "./control-labels.js";
import { WebInspectorElement } from "./index.js";

class LabelTestCore extends CopilotKitCore {
  constructor() {
    super({
      runtimeUrl: "https://runtime.control-labels.test",
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
  }

  async emitStatus(
    status: CopilotKitCoreRuntimeConnectionStatus,
  ): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status,
        }),
      "label test runtime subscriber failed",
    );
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("the launcher shows the shared Threads and Learning labels", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  const inspector = new WebInspectorElement();
  const core = new LabelTestCore();
  document.body.append(inspector);
  inspector.core = core;
  await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);
  await inspector.updateComplete;

  const wrapper = inspector.shadowRoot?.querySelector(
    ".console-button-wrapper",
  );
  wrapper?.dispatchEvent(
    new PointerEvent("pointerenter", { bubbles: true, composed: true }),
  );
  await inspector.updateComplete;

  const labels = Array.from(
    inspector.shadowRoot?.querySelectorAll("[data-cpk-hud-action]") ?? [],
  ).map((node) => node.textContent?.replace(/\s+/g, " ").trim());

  expect(labels).toEqual([INSPECTOR_THREADS_LABEL, INSPECTOR_LEARNING_LABEL]);
  expect(inspector.shadowRoot?.textContent).not.toContain("Rich Threads");
  expect(inspector.shadowRoot?.textContent).not.toContain("Automatic Learning");
});
