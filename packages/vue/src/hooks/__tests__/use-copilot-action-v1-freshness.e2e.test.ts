import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { useCopilotAction } from "../use-copilot-action";
import { mountWithProvider } from "../../v2/__tests__/utils/mount";

function parses(schema: unknown, value: unknown): boolean {
  return (
    schema as { safeParse: (input: unknown) => { success: boolean } }
  ).safeParse(value).success;
}

describe("useCopilotAction v1 live adapter compatibility", () => {
  it("observes reactive handler and renderer values", async () => {
    const firstHandler = vi.fn(() => "first");
    const latestHandler = vi.fn(() => "latest");
    const firstRenderer = vi.fn(() => "first-render");
    const latestRenderer = vi.fn(({ result }: { result?: unknown }) => result);
    const action = ref({
      name: "reactive-action",
      available: "enabled" as const,
      handler: firstHandler,
      render: firstRenderer,
    });

    const ActionUser = defineComponent({
      setup() {
        useCopilotAction(action.value as never);
        return () => null;
      },
    });

    const { getCore, wrapper } = mountWithProvider(() => h(ActionUser));
    await nextTick();

    action.value.handler = latestHandler;
    action.value.render = latestRenderer;

    const tool = getCore().getTool({ toolName: "reactive-action" });
    expect(await tool?.handler?.({} as never, {} as never)).toBe("latest");
    const renderer = getCore().renderToolCalls.find(
      (entry) => entry.name === "reactive-action",
    );
    expect(
      renderer?.render({
        name: "reactive-action",
        toolCallId: "call",
        args: {},
        status: "complete",
        result: '{"latest":true}',
      } as never),
    ).toEqual({ latest: true });
    expect(firstHandler).not.toHaveBeenCalled();
    expect(firstRenderer).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("observes current plain-object metadata after a dependency-triggered update", async () => {
    const dependency = ref(0);
    const action = {
      name: "dependency-action",
      available: "enabled" as const,
      description: "before",
      parameters: [{ name: "before", type: "string" as const }],
      followUp: false,
      handler: () => "before",
      render: vi.fn(({ result }: { result?: unknown }) => result),
    } as {
      name: string;
      available: "enabled";
      description: string;
      parameters: { name: string; type: "string" | "number" }[];
      followUp: boolean;
      handler: () => string;
      render: (props: { result?: unknown }) => unknown;
    };

    const ActionUser = defineComponent({
      setup() {
        useCopilotAction(action as never, [dependency]);
        return () => null;
      },
    });

    const { getCore, wrapper } = mountWithProvider(() => h(ActionUser));
    await nextTick();

    action.description = "after";
    action.parameters = [{ name: "after", type: "number" }];
    action.followUp = true;
    action.handler = () => "after";
    action.render = ({ result }) => result;
    dependency.value++;
    await nextTick();
    await nextTick();

    const tool = getCore().getTool({ toolName: "dependency-action" });
    expect(tool?.description).toBe("after");
    expect(tool?.followUp).toBe(true);
    expect(parses(tool?.parameters, { after: 1 })).toBe(true);
    expect(await tool?.handler?.({} as never, {} as never)).toBe("after");

    const renderer = getCore().renderToolCalls.find(
      (entry) => entry.name === "dependency-action",
    );
    expect(renderer?.args && parses(renderer.args, { after: 1 })).toBe(true);
    expect(
      renderer?.render({
        name: "dependency-action",
        toolCallId: "call",
        args: { after: 1 },
        status: "complete",
        result: '{"after":true}',
      } as never),
    ).toEqual({ after: true });

    wrapper.unmount();
  });

  it("observes current render-only renderer and schema after a dependency update", async () => {
    const dependency = ref(0);
    const action = {
      name: "render-only-action",
      available: "frontend" as const,
      description: "before",
      parameters: [{ name: "before", type: "string" as const }],
      render: () => "before-render",
    } as {
      name: string;
      available: "frontend";
      description: string;
      parameters: { name: string; type: "string" | "number" }[];
      render: (props: { result?: unknown }) => unknown;
    };

    const ActionUser = defineComponent({
      setup() {
        useCopilotAction(action as never, [dependency]);
        return () => null;
      },
    });

    const { getCore, wrapper } = mountWithProvider(() => h(ActionUser));
    await nextTick();

    action.description = "after";
    action.parameters = [{ name: "after", type: "number" }];
    action.render = ({ result }) => result;
    dependency.value++;
    await nextTick();
    await nextTick();

    const renderer = getCore().renderToolCalls.find(
      (entry) => entry.name === "render-only-action",
    );
    expect(renderer?.args && parses(renderer.args, { after: 1 })).toBe(true);
    expect(
      renderer?.render({
        name: "render-only-action",
        toolCallId: "call",
        args: { after: 1 },
        status: "complete",
        result: '{"after":true}',
      } as never),
    ).toEqual({ after: true });

    wrapper.unmount();
  });
});
