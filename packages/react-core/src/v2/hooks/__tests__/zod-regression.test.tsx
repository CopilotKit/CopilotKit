/**
 * Regression tests proving that React hooks and helpers still work
 * identically with Zod schemas after the Standard Schema migration.
 *
 * Covers:
 * 1. useRenderTool with complex Zod schemas
 * 2. defineToolCallRenderer with Zod (named + wildcard default z.any())
 * 3. useComponent with Zod schemas
 * 4. The registered schema object is the original Zod instance (identity check)
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { useRenderTool } from "../use-render-tool";
import { useComponent } from "../use-component";
import { defineToolCallRenderer } from "../../types/defineToolCallRenderer";
import { useCopilotKit } from "../../context";
import { useFrontendTool } from "../use-frontend-tool";
import type { ReactToolCallRenderer } from "../../types/react-tool-call-renderer";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../use-frontend-tool", () => ({
  useFrontendTool: vi.fn(),
}));

type MockCore = {
  renderToolCalls: ReactToolCallRenderer[];
  setRenderToolCalls: ReturnType<typeof vi.fn>;
  addHookRenderToolCall: ReturnType<typeof vi.fn>;
  removeHookRenderToolCall: ReturnType<typeof vi.fn>;
};

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseFrontendTool = useFrontendTool as ReturnType<typeof vi.fn>;

function createMockCore(initial: ReactToolCallRenderer[] = []): MockCore {
  const hookEntries = new Map<string, ReactToolCallRenderer>();
  const core: MockCore = {
    renderToolCalls: initial,
    setRenderToolCalls: vi.fn((next: ReactToolCallRenderer[]) => {
      core.renderToolCalls = next;
    }),
    addHookRenderToolCall: vi.fn((entry: ReactToolCallRenderer) => {
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
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const schema = z.object({
      query: z.string().describe("Search query"),
      filters: z
        .object({
          category: z.enum(["books", "movies"]).optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional(),
    });

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "complexSearch",
          parameters: schema,
          render: () => <div>result</div>,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(1);
    const renderer = core.renderToolCalls.find(
      (r) => r.name === "complexSearch",
    );
    expect(renderer).toBeDefined();
    // The args should be the exact same Zod schema object (identity)
    expect(renderer?.args).toBe(schema);
  });

  it("registers with a Zod schema using enums and defaults", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const schema = z.object({
      sortBy: z.enum(["relevance", "date", "rating"]).default("relevance"),
      page: z.number().int().positive().default(1),
    });

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "sortable",
          parameters: schema,
          render: () => <div>sorted</div>,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    const renderer = core.renderToolCalls.find((r) => r.name === "sortable");
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });

  it("registers with a Zod schema using discriminated union", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const schema = z.object({
      action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("search"), query: z.string() }),
        z.object({ type: z.literal("navigate"), url: z.string().url() }),
      ]),
    });

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "actionRenderer",
          parameters: schema,
          render: () => <div>action</div>,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    const renderer = core.renderToolCalls.find(
      (r) => r.name === "actionRenderer",
    );
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });

  it("registers with a Zod schema using nullable and arrays", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const schema = z.object({
      title: z.string(),
      description: z.string().nullable(),
      tags: z.array(z.string()),
    });

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "taggedItem",
          parameters: schema,
          render: () => <div>item</div>,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    const renderer = core.renderToolCalls.find((r) => r.name === "taggedItem");
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
  });
});

describe("defineToolCallRenderer Zod regression", () => {
  it("wildcard tool defaults to z.any() for args", () => {
    const renderer = defineToolCallRenderer({
      name: "*",
      render: () => React.createElement("div", null, "wildcard"),
    });

    expect(renderer.name).toBe("*");
    // z.any() has vendor "zod" on ~standard
    expect(renderer.args["~standard"].vendor).toBe("zod");
  });

  it("named tool with Zod args preserves schema identity", () => {
    const schema = z.object({
      city: z.string(),
      units: z.enum(["celsius", "fahrenheit"]).optional(),
    });

    const renderer = defineToolCallRenderer({
      name: "weather",
      args: schema,
      render: () => React.createElement("div", null, "weather"),
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
      render: () => React.createElement("div", null, "results"),
    });

    expect(renderer.name).toBe("searchResults");
    expect(renderer.args).toBe(schema);
  });

  it("named tool with agentId", () => {
    const schema = z.object({ query: z.string() });

    const renderer = defineToolCallRenderer({
      name: "agentSearch",
      args: schema,
      render: () => React.createElement("div", null, "agent"),
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
    const WeatherCard: React.FC<{ city: string }> = ({ city }) => (
      <div>{city}</div>
    );

    const schema = z.object({ city: z.string() });

    const Harness: React.FC = () => {
      useComponent({
        name: "weatherCard",
        parameters: schema,
        render: WeatherCard,
      });
      return null;
    };

    render(<Harness />);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { name: string; parameters: any },
    ];
    expect(toolConfig.name).toBe("weatherCard");
    expect(toolConfig.parameters).toBe(schema);
    expect(toolConfig.parameters["~standard"].vendor).toBe("zod");
  });

  it("registers a component with a complex Zod schema", () => {
    const DataGrid: React.FC<{
      columns: string[];
      sortBy: string;
    }> = () => <div>grid</div>;

    const schema = z.object({
      columns: z.array(z.string()),
      sortBy: z.enum(["name", "date", "size"]).default("name"),
    });

    const Harness: React.FC = () => {
      useComponent({
        name: "dataGrid",
        parameters: schema,
        render: DataGrid,
      });
      return null;
    };

    render(<Harness />);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { name: string; parameters: any },
    ];
    expect(toolConfig.name).toBe("dataGrid");
    expect(toolConfig.parameters).toBe(schema);
  });
});
