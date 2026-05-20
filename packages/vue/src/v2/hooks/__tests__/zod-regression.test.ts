/**
 * Regression tests proving that Vue hooks and helpers still work
 * identically with Zod schemas after the Standard Schema migration.
 *
 * Covers:
 * 1. useRenderTool with complex Zod schemas
 * 2. defineToolCallRenderer with Zod (named + wildcard default z.any())
 * 3. useComponent with Zod schemas
 * 4. The registered schema object is the original Zod instance (identity check)
 */
import { render } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { useRenderTool } from "../use-render-tool";
import { useComponent } from "../use-component";
import { defineToolCallRenderer } from "../../types/defineToolCallRenderer";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useFrontendTool } from "../use-frontend-tool";
import type { VueToolCallRenderer } from "../../types/vue-tool-call-renderer";

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

function createMockCore(initial: VueToolCallRenderer[] = []): MockCore {
  const hookEntries = new Map<string, VueToolCallRenderer>();
  const core: MockCore = {
    renderToolCalls: initial,
    setRenderToolCalls: vi.fn((next: VueToolCallRenderer[]) => {
      core.renderToolCalls = next;
    }),
    addHookRenderToolCall: vi.fn((entry: VueToolCallRenderer) => {
      const key = `${entry.agentId ?? ""}:${entry.name}`;
      hookEntries.set(key, entry);
      core.renderToolCalls = [...initial, ...hookEntries.values()];
    }),
    removeHookRenderToolCall: vi.fn(),
  };
  return core;
}

describe("useRenderTool Zod regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers with a complex Zod schema and preserves schema identity", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const schema = z.object({
      query: z.string().describe("Search query"),
      filters: z
        .object({
          category: z.enum(["books", "movies"]).optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional(),
    });

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "complexSearch",
            parameters: schema,
            render: () => "result",
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
      (r) => r.name === "complexSearch",
    );
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });

  it("registers with a Zod schema using enums and defaults", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const schema = z.object({
      sortBy: z.enum(["relevance", "date", "rating"]).default("relevance"),
      page: z.number().int().positive().default(1),
    });

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "sortable",
            parameters: schema,
            render: () => "sorted",
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const renderer = core.renderToolCalls.find((r) => r.name === "sortable");
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });

  it("registers with a Zod schema using discriminated union", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const schema = z.object({
      action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("search"), query: z.string() }),
        z.object({ type: z.literal("navigate"), url: z.string().url() }),
      ]),
    });

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "actionRenderer",
            parameters: schema,
            render: () => "action",
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const renderer = core.renderToolCalls.find(
      (r) => r.name === "actionRenderer",
    );
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });

  it("registers with a Zod schema using nullable and arrays", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: { value: core } });

    const schema = z.object({
      title: z.string(),
      description: z.string().nullable(),
      tags: z.array(z.string()),
    });

    const Harness = defineComponent({
      setup() {
        useRenderTool(
          {
            name: "taggedItem",
            parameters: schema,
            render: () => "item",
          },
          [],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const renderer = core.renderToolCalls.find((r) => r.name === "taggedItem");
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });
});

describe("defineToolCallRenderer Zod regression", () => {
  it("wildcard tool defaults to z.any() for args", () => {
    const renderer = defineToolCallRenderer({
      name: "*",
      render: () => "wildcard",
    });

    expect(renderer.name).toBe("*");
    expect((renderer.args as any)["~standard"].vendor).toBe("zod");
  });

  it("named tool with Zod args preserves schema identity", () => {
    const schema = z.object({
      city: z.string(),
      units: z.enum(["celsius", "fahrenheit"]).optional(),
    });

    const renderer = defineToolCallRenderer({
      name: "weather",
      args: schema,
      render: () => "weather",
    });

    expect(renderer.name).toBe("weather");
    expect(renderer.args).toBe(schema);
  });

  it("named tool with complex Zod args", () => {
    const schema = z.object({
      results: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          score: z.number().min(0).max(1),
        }),
      ),
    });

    const renderer = defineToolCallRenderer({
      name: "searchResults",
      args: schema,
      render: () => "results",
    });

    expect(renderer.name).toBe("searchResults");
    expect(renderer.args).toBe(schema);
  });

  it("named tool with agentId", () => {
    const schema = z.object({ query: z.string() });

    const renderer = defineToolCallRenderer({
      name: "agentSearch",
      args: schema,
      render: () => "agent",
      agentId: "agent-123",
    });

    expect(renderer.name).toBe("agentSearch");
    expect(renderer.agentId).toBe("agent-123");
    expect(renderer.args).toBe(schema);
  });
});

describe("useComponent Zod regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a component with a Zod schema", () => {
    const WeatherCard = defineComponent({
      props: {
        city: { type: String, required: true },
      },
      template: `<div>{{ city }}</div>`,
    });

    const schema = z.object({ city: z.string() });

    const Harness = defineComponent({
      setup() {
        useComponent({
          name: "weatherCard",
          parameters: schema,
          render: WeatherCard,
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
    expect(toolConfig.parameters).toBe(schema);
    expect(toolConfig.parameters["~standard"].vendor).toBe("zod");
  });

  it("registers a component with a complex Zod schema", () => {
    const DataGrid = defineComponent({
      props: {
        columns: {
          type: Array as () => string[],
          required: true,
        },
        sortBy: {
          type: String,
          required: true,
        },
      },
      template: `<div>grid</div>`,
    });

    const schema = z.object({
      columns: z.array(z.string()),
      sortBy: z.enum(["name", "date", "size"]).default("name"),
    });

    const Harness = defineComponent({
      setup() {
        useComponent({
          name: "dataGrid",
          parameters: schema,
          render: DataGrid,
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
    expect(toolConfig.name).toBe("dataGrid");
    expect(toolConfig.parameters).toBe(schema);
  });
});
