import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { useRenderTool, type RenderToolProps } from "../use-render-tool";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import type { ReactToolCallRenderer } from "@/types/react-tool-call-renderer";

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

type MockCore = {
  renderToolCalls: ReactToolCallRenderer[];
  setRenderToolCalls: ReturnType<typeof vi.fn>;
};

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

function createMockCore(
  initialRenderToolCalls: ReactToolCallRenderer[] = [],
): MockCore {
  const core: MockCore = {
    renderToolCalls: initialRenderToolCalls,
    setRenderToolCalls: vi.fn((next: ReactToolCallRenderer[]) => {
      core.renderToolCalls = next;
    }),
  };

  return core;
}

describe("useRenderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a named renderer with args schema", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const schema = z.object({ query: z.string() });
    const renderFn = vi.fn((_props: RenderToolProps<typeof schema>) => (
      <div>render</div>
    ));

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "searchDocs",
          args: schema,
          render: renderFn,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    expect(core.setRenderToolCalls).toHaveBeenCalledTimes(1);
    const renderer = core.renderToolCalls.find(
      (item) => item.name === "searchDocs",
    );
    expect(renderer).toBeDefined();
    expect(renderer?.args).toBe(schema);
    expect(renderer?.render).toBe(renderFn);
  });

  it("registers wildcard renderer and defaults args schema to z.any", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const wildcardRender = vi.fn(() => <div>wildcard</div>);

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "*",
          render: wildcardRender,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    const renderer = core.renderToolCalls.find((item) => item.name === "*");
    expect(renderer).toBeDefined();
    expect(renderer?.render).toBe(wildcardRender);
    expect(renderer?.args.safeParse({ arbitrary: true }).success).toBe(true);
  });

  it("deduplicates by agentId:name and keeps unrelated entries", () => {
    const oldRenderer: ReactToolCallRenderer = {
      name: "searchDocs",
      agentId: "agent-1",
      args: z.object({ query: z.string() }),
      render: () => <div>old</div>,
    };
    const untouchedRenderer: ReactToolCallRenderer = {
      name: "otherTool",
      args: z.object({ id: z.string() }),
      render: () => <div>other</div>,
    };

    const core = createMockCore([oldRenderer, untouchedRenderer]);
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const newRender = vi.fn(() => <div>new</div>);

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "searchDocs",
          agentId: "agent-1",
          args: z.object({ query: z.string() }),
          render: newRender,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

    const updated = core.renderToolCalls.find(
      (item) => item.name === "searchDocs" && item.agentId === "agent-1",
    );
    const untouched = core.renderToolCalls.find(
      (item) => item.name === "otherTool",
    );

    expect(core.renderToolCalls).toHaveLength(2);
    expect(updated?.render).toBe(newRender);
    expect(untouched).toBe(untouchedRenderer);
  });

  it("keeps separate entries for same name across different agentId values", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const RendererA: React.FC = () => {
      useRenderTool(
        {
          name: "summarize",
          agentId: "agent-a",
          args: z.object({ text: z.string() }),
          render: () => <div>A</div>,
        },
        [],
      );
      return null;
    };

    const RendererB: React.FC = () => {
      useRenderTool(
        {
          name: "summarize",
          agentId: "agent-b",
          args: z.object({ text: z.string() }),
          render: () => <div>B</div>,
        },
        [],
      );
      return null;
    };

    render(
      <>
        <RendererA />
        <RendererB />
      </>,
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

  it("re-registers when deps change", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const Harness: React.FC<{ version: string }> = ({ version }) => {
      useRenderTool(
        {
          name: "searchDocs",
          args: z.object({ query: z.string() }),
          render: () => <div>{version}</div>,
        },
        [version],
      );
      return null;
    };

    const ui = render(<Harness version="v1" />);
    expect(core.setRenderToolCalls).toHaveBeenCalledTimes(1);

    ui.rerender(<Harness version="v2" />);
    expect(core.setRenderToolCalls).toHaveBeenCalledTimes(2);
  });

  it("does not remove renderer on unmount", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "searchDocs",
          args: z.object({ query: z.string() }),
          render: () => <div>render</div>,
        },
        [],
      );
      return null;
    };

    const ui = render(<Harness />);
    const setCallsAfterMount = core.setRenderToolCalls.mock.calls.length;
    ui.unmount();

    expect(core.setRenderToolCalls).toHaveBeenCalledTimes(setCallsAfterMount);
    expect(
      core.renderToolCalls.find((item) => item.name === "searchDocs"),
    ).toBeDefined();
  });
});
