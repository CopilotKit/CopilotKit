import { describe, expect, it } from "vitest";
import { CopilotKitCoreReact } from "../react-core";
import type { ReactToolCallRenderer } from "../../types";
import type { ReactActivityMessageRenderer } from "../../types";
import type { ReactCustomMessageRenderer } from "../../types/react-custom-message-renderer";

function createCore() {
  const core = new CopilotKitCoreReact({});
  const events: string[] = [];
  core.subscribe({
    onRenderToolCallsChanged: () => {
      events.push("toolCalls");
    },
    onRenderActivityMessagesChanged: () => {
      events.push("activity");
    },
    onRenderCustomMessagesChanged: () => {
      events.push("custom");
    },
  });
  return { core, events };
}

const searchRenderer: ReactToolCallRenderer<unknown> = {
  name: "search",
  render: () => null,
};
const customRenderer: ReactCustomMessageRenderer = { render: () => null };
const activityRenderer: ReactActivityMessageRenderer<unknown> = {
  activityType: "plan",
  content: {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value }),
    },
  },
  render: () => null,
};

describe("CopilotKitCoreReact renderer lists", () => {
  it("notifies subscribers when custom message renderers change", () => {
    const { core, events } = createCore();

    core.setRenderCustomMessages([customRenderer]);

    expect(events).toEqual(["custom"]);
    expect(core.renderCustomMessages).toEqual([customRenderer]);
  });

  it("notifies subscribers when activity renderers change", () => {
    const { core, events } = createCore();

    core.setRenderActivityMessages([activityRenderer]);

    expect(events).toEqual(["activity"]);
  });

  it("keeps a copy of the renderer list it was given", () => {
    const { core } = createCore();
    const renderers = [searchRenderer];

    core.setRenderToolCalls(renderers);
    renderers.push({ name: "weather", render: () => null });

    expect(core.renderToolCalls.map((renderer) => renderer.name)).toEqual([
      "search",
    ]);
  });

  it("keeps the same renderToolCalls array until the renderers change", () => {
    const { core } = createCore();
    core.addHookRenderToolCall(searchRenderer);

    expect(core.renderToolCalls).toBe(core.renderToolCalls);
  });
});
