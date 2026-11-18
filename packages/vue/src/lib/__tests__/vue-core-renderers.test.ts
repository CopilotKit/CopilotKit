import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { CopilotKitCoreVue } from "../vue-core";
import type { VueActivityMessageRenderer } from "../../types";

const planRenderer: VueActivityMessageRenderer<unknown> = {
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

describe("CopilotKitCoreVue renderer lists", () => {
  it("notifies subscribers when activity renderers change", () => {
    const core = new CopilotKitCoreVue({});
    const seen: string[][] = [];
    core.subscribe({
      onRenderActivityMessagesChanged: ({ renderActivityMessages }) => {
        seen.push(renderActivityMessages.map((r) => r.activityType));
      },
    });

    core.setRenderActivityMessages([planRenderer]);

    expect(seen).toEqual([["plan"]]);
  });

  it("keeps working behind a Vue reactive proxy", () => {
    const wrapped = ref(new CopilotKitCoreVue({}));

    wrapped.value.addHookRenderToolCall({ name: "search", render: () => null });

    expect(wrapped.value.renderToolCalls.map((r) => r.name)).toEqual([
      "search",
    ]);
  });
});
