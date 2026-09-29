import { HttpAgent } from "@ag-ui/client";
import { CopilotKitCore } from "@copilotkit/core";
import { expect, test, vi } from "vitest";
import { WebInspectorElement } from "../index.js";

/** Creates a real streaming agent and Inspector without a remote runtime. */
async function setup() {
  const agent = new HttpAgent({
    agentId: "refund",
    url: "https://fixture.invalid/run",
    fetch: async (_url, options) => {
      const input: unknown = JSON.parse(String(options?.body));
      if (
        !input ||
        typeof input !== "object" ||
        !("threadId" in input) ||
        typeof input.threadId !== "string" ||
        !("runId" in input) ||
        typeof input.runId !== "string"
      )
        throw new Error("Invalid test run input");
      return new Response(
        [
          { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
          {
            type: "RUN_FINISHED",
            threadId: input.threadId,
            runId: input.runId,
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const onRunStartedEvent = vi.fn();
  agent.subscribe({ onRunStartedEvent });
  const core = new CopilotKitCore({
    agents__unsafe_dev_only: { refund: agent },
  });
  const inspector = new WebInspectorElement();
  inspector.autoAttachCore = false;
  inspector.core = core;
  document.body.append(inspector);
  await inspector.updateComplete;
  const root = inspector.shadowRoot;
  if (!root) throw new Error("Inspector shadow root missing");
  const launcher = root.querySelector<HTMLButtonElement>(
    'button[aria-label="Web Inspector"]',
  );
  if (!launcher) throw new Error("Inspector launcher missing");
  launcher.click();
  await inspector.updateComplete;
  const events = root.querySelector<HTMLButtonElement>(
    '[data-inspector-menu-key="ag-ui-events"]',
  );
  if (!events) throw new Error("Events navigation missing");
  events.click();
  await inspector.updateComplete;
  return {
    agent,
    core,
    inspector,
    root,
    onRunStartedEvent,
    cleanup: () => inspector.remove(),
  };
}

test("a cloned agent records each event once and retains application subscribers", async () => {
  const world = await setup();
  try {
    const clone = world.agent.clone();

    await world.core.runAgent({ agent: clone });
    await world.inspector.updateComplete;

    expect(world.onRunStartedEvent).toHaveBeenCalledTimes(1);
    expect(world.root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(world.root.textContent?.replace(/\s+/g, " ")).toContain(
      "Showing 2 of 2",
    );

    await world.core.runAgent({ agent: clone.clone() });
    await world.inspector.updateComplete;

    expect(world.onRunStartedEvent).toHaveBeenCalledTimes(2);
    expect(world.root.querySelectorAll("tbody tr")).toHaveLength(4);
  } finally {
    world.cleanup();
  }
});
