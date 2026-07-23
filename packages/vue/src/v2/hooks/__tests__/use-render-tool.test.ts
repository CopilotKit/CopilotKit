import { render } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { useRenderTool } from "../use-render-tool";
import type { RenderToolProps } from "../use-render-tool";
import { useCopilotKit } from "../../providers/useCopilotKit";
import type { VueToolCallRenderer } from "../../types/vue-tool-call-renderer";

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

type MockCore = {
  renderToolCalls: VueToolCallRenderer[];
  setRenderToolCalls: ReturnType<typeof vi.fn>;
  addHookRenderToolCall: ReturnType<typeof vi.fn>;
  removeHookRenderToolCall: ReturnType<typeof vi.fn>;
};

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

function createMockCore(
  initialRenderToolCalls: VueToolCallRenderer[] = [],
): MockCore {
  const hookEntries = new Map<string, VueToolCallRenderer>();

  const core: MockCore = {
    get renderToolCalls() {
      if (hookEntries.size === 0) return initialRenderToolCalls;
      const merged = new Map<string, VueToolCallRenderer>();
      for (const rc of initialRenderToolCalls) {
        merged.set(`${rc.agentId ?? ""}:${rc.name}`, rc);
      }
      for (const [key, rc] of hookEntries) {
        merged.set(key, rc);
      }
      return Array.from(merged.values());
    },
    setRenderToolCalls: vi.fn((next: VueToolCallRenderer[]) => {
      initialRenderToolCalls = next;
    }),
    addHookRenderToolCall: vi.fn((entry: VueToolCallRenderer) => {
      const key = `${entry.agentId ?? ""}:${entry.name}`;
      hookEntries.set(key, entry);
    }),
    removeHookRenderToolCall: vi.fn((name: string, agentId?: string) => {
      const key = `${agentId ?? ""}:${name}`;
      hookEntries.delete(key);
    }),
  };

  return core;
}

describe("useRenderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a named renderer with parameters schema", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const schema = z.object({ query: z.string() });
    const renderFn = vi.fn(
      (_props: RenderToolProps<typeof schema>) => "render",
    );

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "searchDocs",
            parameters: schema,
            render: renderFn,
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(1);
    const renderer = core.renderToolCalls.find(
      (item) => item.name === "searchDocs",
    );
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
    expect(typeof renderer?.render).toBe("function");
  });

  it("registers wildcard renderer and defaults parameters schema to z.any", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const wildcardRender = vi.fn(() => "wildcard");

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "*",
            render: wildcardRender,
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const renderer = core.renderToolCalls.find((item) => item.name === "*");
    expect(renderer).toBeDefined();
    expect(typeof renderer?.render).toBe("function");
    const wildcardArgs = renderer?.args as
      | { safeParse: (v: unknown) => { success: boolean } }
      | undefined;
    expect(wildcardArgs).toBeDefined();
    expect(wildcardArgs!.safeParse({ arbitrary: true }).success).toBe(true);
  });

  it("accepts a Vue component renderer", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const ToolRenderer = defineComponent({
      props: {
        name: { type: String, required: true },
        status: { type: String, required: true },
      },
      template: `<div>{{ name }} {{ status }}</div>`,
    });

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "componentTool",
            parameters: z.object({ query: z.string() }),
            render: ToolRenderer,
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const renderer = core.renderToolCalls.find(
      (item) => item.name === "componentTool",
    );
    expect(renderer).toBeDefined();
    expect(typeof renderer?.render).toBe("function");
  });

  it("deduplicates by agentId:name and keeps unrelated entries", () => {
    const oldRenderer: VueToolCallRenderer = {
      name: "searchDocs",
      agentId: "agent-1",
      args: z.object({ query: z.string() }),
      render: () => "old",
    };
    const untouchedRenderer: VueToolCallRenderer = {
      name: "otherTool",
      args: z.object({ id: z.string() }),
      render: () => "other",
    };

    const core = createMockCore([oldRenderer, untouchedRenderer]);
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const newRender = vi.fn(() => "new");

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "searchDocs",
            agentId: "agent-1",
            parameters: z.object({ query: z.string() }),
            render: newRender,
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const updated = core.renderToolCalls.find(
      (item) => item.name === "searchDocs" && item.agentId === "agent-1",
    );
    const untouched = core.renderToolCalls.find(
      (item) => item.name === "otherTool",
    );

    expect(core.renderToolCalls).toHaveLength(2);
    expect(typeof updated?.render).toBe("function");
    expect(untouched).toBe(untouchedRenderer);
  });

  it("keeps separate entries for same name across different agentId values", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const RendererA = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "summarize",
            agentId: "agent-a",
            parameters: z.object({ text: z.string() }),
            render: () => "A",
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    const RendererB = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "summarize",
            agentId: "agent-b",
            parameters: z.object({ text: z.string() }),
            render: () => "B",
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(
      defineComponent({
        components: { RendererA, RendererB },
        template: `<div><RendererA /><RendererB /></div>`,
      }),
    );

    const byName = core.renderToolCalls.filter(
      (item) => item.name === "summarize",
    );
    expect(byName).toHaveLength(2);
    expect(byName.map((item) => item.agentId).sort()).toEqual([
      "agent-a",
      "agent-b",
    ]);
  });

  it("re-registers when deps change", async () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const Harness = defineComponent({
      props: {
        version: { type: String, required: true },
      },
      setup(props) {
        useRenderTool(
          {
            name: "searchDocs",
            parameters: z.object({ query: z.string() }),
            render: () => props.version,
          },
          [() => props.version],
        );
        return {};
      },
      template: `<div />`,
    });

    const ui = render(Harness, {
      props: {
        version: "v1",
      },
    });
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(1);

    await ui.rerender({
      version: "v2",
    });
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(2);
  });

  it("does not remove renderer on unmount", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "searchDocs",
            parameters: z.object({ query: z.string() }),
            render: () => "render",
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    const ui = render(Harness);
    const callsAfterMount = core.addHookRenderToolCall.mock.calls.length;
    ui.unmount();

    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(callsAfterMount);
    expect(core.removeHookRenderToolCall).not.toHaveBeenCalled();
    expect(
      core.renderToolCalls.find((item) => item.name === "searchDocs"),
    ).toBeDefined();
  });
});
