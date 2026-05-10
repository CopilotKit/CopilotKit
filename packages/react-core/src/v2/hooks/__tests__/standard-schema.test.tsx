import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { type } from "arktype";
import { useRenderTool, type RenderToolProps } from "../use-render-tool";
import { useComponent } from "../use-component";
import { useCopilotKit } from "../../context";
import { useFrontendTool } from "../use-frontend-tool";
import type { ReactToolCallRenderer } from "../../types/react-tool-call-renderer";
import type { StandardSchemaV1 } from "@copilotkit/shared";

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

function createMockCore(
  initialRenderToolCalls: ReactToolCallRenderer[] = [],
): MockCore {
  const hookEntries = new Map<string, ReactToolCallRenderer>();
  const core: MockCore = {
    renderToolCalls: initialRenderToolCalls,
    setRenderToolCalls: vi.fn((next: ReactToolCallRenderer[]) => {
      core.renderToolCalls = next;
    }),
    addHookRenderToolCall: vi.fn((entry: ReactToolCallRenderer) => {
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
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const schema = z.object({ query: z.string() });

      const Harness: React.FC = () => {
        useRenderTool(
          {
            name: "search",
            parameters: schema,
            render: () => <div>render</div>,
          },
          [],
        );
        return null;
      };

      render(<Harness />);

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
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const schema = v.object({ query: v.string() });

      const Harness: React.FC = () => {
        useRenderTool(
          {
            name: "searchValibot",
            parameters: schema as unknown as StandardSchemaV1<
              any,
              { query: string }
            >,
            render: () => <div>valibot render</div>,
          },
          [],
        );
        return null;
      };

      render(<Harness />);

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
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const schema = type({ query: "string" });

      const Harness: React.FC = () => {
        useRenderTool(
          {
            name: "searchArktype",
            parameters: schema as unknown as StandardSchemaV1<
              any,
              { query: string }
            >,
            render: () => <div>arktype render</div>,
          },
          [],
        );
        return null;
      };

      render(<Harness />);

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
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const ZodHarness: React.FC = () => {
        useRenderTool(
          {
            name: "zodRenderer",
            parameters: z.object({ a: z.string() }),
            render: () => <div>zod</div>,
          },
          [],
        );
        return null;
      };

      const ValibotHarness: React.FC = () => {
        useRenderTool(
          {
            name: "valibotRenderer",
            parameters: v.object({
              b: v.string(),
            }) as unknown as StandardSchemaV1<any, { b: string }>,
            render: () => <div>valibot</div>,
          },
          [],
        );
        return null;
      };

      const ArktypeHarness: React.FC = () => {
        useRenderTool(
          {
            name: "arktypeRenderer",
            parameters: type({
              c: "string",
            }) as unknown as StandardSchemaV1<any, { c: string }>,
            render: () => <div>arktype</div>,
          },
          [],
        );
        return null;
      };

      render(
        <>
          <ZodHarness />
          <ValibotHarness />
          <ArktypeHarness />
        </>,
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
    const DemoComponent: React.FC<{ city: string }> = ({ city }) => (
      <div>{city}</div>
    );

    const schema = v.object({
      city: v.string(),
    });

    const Harness: React.FC = () => {
      useComponent({
        name: "weatherCard",
        parameters: schema as unknown as StandardSchemaV1<
          any,
          { city: string }
        >,
        render: DemoComponent,
      });
      return null;
    };

    render(<Harness />);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { name: string; parameters: any },
    ];
    expect(toolConfig.name).toBe("weatherCard");
    expect(toolConfig.parameters["~standard"].vendor).toBe("valibot");
  });

  it("registers a component with an ArkType schema", () => {
    const DemoComponent: React.FC<{ city: string }> = ({ city }) => (
      <div>{city}</div>
    );

    const schema = type({ city: "string" });

    const Harness: React.FC = () => {
      useComponent({
        name: "weatherCardArktype",
        parameters: schema as unknown as StandardSchemaV1<
          any,
          { city: string }
        >,
        render: DemoComponent,
      });
      return null;
    };

    render(<Harness />);

    expect(mockUseFrontendTool).toHaveBeenCalledTimes(1);
    const [toolConfig] = mockUseFrontendTool.mock.calls[0] as [
      { name: string; parameters: any },
    ];
    expect(toolConfig.name).toBe("weatherCardArktype");
    expect(toolConfig.parameters["~standard"].vendor).toBe("arktype");
  });
});
