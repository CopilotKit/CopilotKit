import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import { CopilotKitKey } from "../../providers/keys";
import type * as WebCore from "@a2ui/web_core/v0_9";

// Capture the action handler the renderer passes to MessageProcessor.
const captured = vi.hoisted(() => ({
  onAction: undefined as undefined | ((action: unknown) => unknown),
}));

vi.mock("@a2ui/web_core/v0_9", async (importOriginal) => {
  const actual = await importOriginal<typeof WebCore>();
  class CapturingMessageProcessor extends actual.MessageProcessor<any> {
    constructor(catalogs: any, onAction: (action: unknown) => unknown) {
      super(catalogs, onAction as any);
      captured.onAction = onAction;
    }
  }
  return { ...actual, MessageProcessor: CapturingMessageProcessor };
});

import A2UISurfaceActivityRenderer from "../A2UISurfaceActivityRenderer.vue";

const operations = [
  {
    version: "v0.9",
    createSurface: {
      surfaceId: "surface-1",
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
    },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "surface-1",
      components: [
        { id: "root", component: "Text", text: "Hello", variant: "body" },
      ],
    },
  },
];

describe("A2UISurfaceActivityRenderer action handler", () => {
  it("returns a promise that settles after the agent run", async () => {
    let finishRun!: () => void;
    const runAgent = vi.fn(
      () => new Promise<void>((resolve) => (finishRun = resolve)),
    );
    render(A2UISurfaceActivityRenderer, {
      props: {
        activityType: "a2ui-surface",
        content: { operations },
        message: {} as any,
        agent: {},
      },
      global: {
        provide: {
          [CopilotKitKey as symbol]: {
            copilotkit: ref({
              properties: {},
              setProperties: () => undefined,
              runAgent,
            }),
          },
        },
      },
    });
    await waitFor(() => expect(captured.onAction).toBeDefined());

    const log: string[] = [];
    const result = captured.onAction!({ name: "click" });
    expect(result).toBeInstanceOf(Promise);
    void (result as Promise<unknown>).then(() => log.push("resolved"));

    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(log).toEqual([]);

    finishRun();
    await waitFor(() => expect(log).toEqual(["resolved"]));
  });
});
