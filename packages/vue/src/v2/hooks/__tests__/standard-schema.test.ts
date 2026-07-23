import { render } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { type } from "arktype";
import { useRenderTool } from "../use-render-tool";
import { useComponent } from "../use-component";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useFrontendTool } from "../use-frontend-tool";
import type { VueToolCallRenderer } from "../../types/vue-tool-call-renderer";
import type { StandardSchemaV1 } from "@copilotkit/shared";

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../use-frontend-tool", () => ({
  useFrontendTool: vi.fn(),
}));

type MockCore = {
  renderToolCalls: VueToolCallRenderer[];
  setRenderToolCalls: ReturnType<typeof vi.fn>;
  addHookRenderToolCall: ReturnType<typeof vi.fn>;
  removeHookRenderToolCall: ReturnType<typeof vi.fn>;
};

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseFrontendTool = useFrontendTool as ReturnType<typeof vi.fn>;

function createMockCore(
  initialRenderToolCalls: VueToolCallRenderer[] = [],
): MockCore {
  const hookEntries = new Map<string, VueToolCallRenderer>();
  const core: MockCore = {
    renderToolCalls: initialRenderToolCalls,
    setRenderToolCalls: vi.fn((next: VueToolCallRenderer[]) => {
      core.renderToolCalls = next;
    }),
    addHookRenderToolCall: vi.fn((entry: VueToolCallRenderer) => {
      const key = `${entry.agentId ?? ""}:${entry.name}`;
      hookEntries.set(key, entry);
      core.renderToolCalls = [
        ...initialRenderToolCalls,
        ...hookEntries.values(),
      ];
    }),
    removeHookRenderToolCall: vi.fn(),
  };

  return core;
}

describe("useRenderTool with Standard Schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Zod schemas (existing behavior)", () => {
    it("registers a renderer with a Zod schema", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

      const schema = z.object({ query: z.string() });

      const Harness = defineComponent({
        setup() {
          useRenderTool(
            {
              name: "search",
              parameters: schema,
              render: () => "render",
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
        (item) => item.name === "search",
      );
      expect(renderer).toBeDefined();
      expect(renderer?.args).toBe(schema);
    });
  });

  describe("Valibot schemas", () => {
    it("registers a renderer with a Valibot schema", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

      const schema = v.object({ query: v.string() });

      const Harness = defineComponent({
        setup() {
          useRenderTool(
            {
              name: "searchValibot",
              parameters: schema as unknown as StandardSchemaV1<
                any,
                { query: string }
              >,
              render: () => "valibot render",
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
        (item) => item.name === "searchValibot",
      );
      expect(renderer).toBeDefined();
      expect(renderer?.args["~standard"].vendor).toBe("valibot");
    });
  });

  describe("ArkType schemas", () => {
    it("registers a renderer with an ArkType schema", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

      const schema = type({ query: "string" });

      const Harness = defineComponent({
        setup() {
          useRenderTool(
            {
              name: "searchArktype",
              parameters: schema as unknown as StandardSchemaV1<
                any,
                { query: string }
              >,
              render: () => "arktype render",
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
        (item) => item.name === "searchArktype",
      );
      expect(renderer).toBeDefined();
      expect(renderer?.args["~standard"].vendor).toBe("arktype");
    });
  });

  describe("Mixed schemas in the same registry", () => {
    it("registers renderers with Zod, Valibot, and ArkType schemas", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

      const ZodHarness = defineComponent({
        setup() {
          useRenderTool(
            {
              name: "zodRenderer",
              parameters: z.object({ a: z.string() }),
              render: () => "zod",
            },
            [],
          );
          return {};
        },
        template: `<div />`,
      });

      const ValibotHarness = defineComponent({
        setup() {
          useRenderTool(
            {
              name: "valibotRenderer",
              parameters: v.object({
                b: v.string(),
              }) as unknown as StandardSchemaV1<any, { b: string }>,
              render: () => "valibot",
            },
            [],
          );
          return {};
        },
        template: `<div />`,
      });

      const ArktypeHarness = defineComponent({
        setup() {
          useRenderTool(
            {
              name: "arktypeRenderer",
              parameters: type({
                c: "string",
              }) as unknown as StandardSchemaV1<any, { c: string }>,
              render: () => "arktype",
            },
            [],
          );
          return {};
        },
        template: `<div />`,
      });

      render(
        defineComponent({
          components: {
            ZodHarness,
            ValibotHarness,
            ArktypeHarness,
          },
          template: `<div><ZodHarness /><ValibotHarness /><ArktypeHarness /></div>`,
        }),
      );

      expect(core.renderToolCalls).toHaveLength(3);
      const names = core.renderToolCalls.map((r) => r.name);
      expect(names).toContain("zodRenderer");
      expect(names).toContain("valibotRenderer");
      expect(names).toContain("arktypeRenderer");
    });
  });
});

describe("useComponent with Standard Schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a component with a Valibot schema", () => {
    const DemoComponent = defineComponent({
      props: {
        city: { type: String, required: true },
      },
      template: `<div>{{ city }}</div>`,
    });

    const schema = v.object({
      city: v.string(),
    });

    const Harness = defineComponent({
      setup() {
        useComponent({
          name: "weatherCard",
          parameters: schema as unknown as StandardSchemaV1<
            any,
            { city: string }
          >,
          render: DemoComponent,
        });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { name: string; parameters: any },
    ];
    expect(toolConfig.name).toBe("weatherCard");
    expect(toolConfig.parameters["~standard"].vendor).toBe("valibot");
  });

  it("registers a component with an ArkType schema", () => {
    const DemoComponent = defineComponent({
      props: {
        city: { type: String, required: true },
      },
      template: `<div>{{ city }}</div>`,
    });

    const schema = type({ city: "string" });

    const Harness = defineComponent({
      setup() {
        useComponent({
          name: "weatherCardArk",
          parameters: schema as unknown as StandardSchemaV1<
            any,
            { city: string }
          >,
          render: DemoComponent,
        });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { name: string; parameters: any },
    ];
    expect(toolConfig.name).toBe("weatherCardArk");
    expect(toolConfig.parameters["~standard"].vendor).toBe("arktype");
  });
});
