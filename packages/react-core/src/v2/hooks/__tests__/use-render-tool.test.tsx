import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { useRenderTool, type RenderToolProps } from "../use-render-tool";
import { useCopilotKit } from "../../context";
import type { ReactToolCallRenderer } from "../../types/react-tool-call-renderer";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

type MockCore = {
  renderToolCalls: ReactToolCallRenderer[];
  setRenderToolCalls: ReturnType<typeof vi.fn>;
  addHookRenderToolCall: ReturnType<typeof vi.fn>;
  removeHookRenderToolCall: ReturnType<typeof vi.fn>;
};

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

function createMockCore(
  initialRenderToolCalls: ReactToolCallRenderer[] = [],
): MockCore {
  const hookEntries = new Map<string, ReactToolCallRenderer>();

  const core: MockCore = {
    get renderToolCalls() {
      if (hookEntries.size === 0) return initialRenderToolCalls;
      const merged = new Map<string, ReactToolCallRenderer>();
      for (const rc of initialRenderToolCalls) {
        merged.set(`${rc.agentId ?? ""}:${rc.name}`, rc);
      }
      for (const [key, rc] of hookEntries) {
        merged.set(key, rc);
      }
      return Array.from(merged.values());
    },
    setRenderToolCalls: vi.fn((next: ReactToolCallRenderer[]) => {
      initialRenderToolCalls = next;
    }),
    addHookRenderToolCall: vi.fn((entry: ReactToolCallRenderer) => {
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
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const schema = z.object({ query: z.string() });
    const renderFn = vi.fn((_props: RenderToolProps<typeof schema>) => (
      <div>render</div>
    ));

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "searchDocs",
          parameters: schema,
          render: renderFn,
        },
        [],
      );
      return null;
    };

    render(<Harness />);

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
    expect(typeof renderer?.render).toBe("function");
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
          parameters: z.object({ query: z.string() }),
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
    expect(typeof updated?.render).toBe("function");
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
          parameters: z.object({ text: z.string() }),
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
          parameters: z.object({ text: z.string() }),
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
          parameters: z.object({ query: z.string() }),
          render: () => <div>{version}</div>,
        },
        [version],
      );
      return null;
    };

    const ui = render(<Harness version="v1" />);
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(1);

    ui.rerender(<Harness version="v2" />);
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(2);
  });

  it("does not remove renderer on unmount", () => {
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const Harness: React.FC = () => {
      useRenderTool(
        {
          name: "searchDocs",
          parameters: z.object({ query: z.string() }),
          render: () => <div>render</div>,
        },
        [],
      );
      return null;
    };

    const ui = render(<Harness />);
    const callsAfterMount = core.addHookRenderToolCall.mock.calls.length;
    ui.unmount();

    // No additional calls after unmount — renderer kept for chat history
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(callsAfterMount);
    expect(core.removeHookRenderToolCall).not.toHaveBeenCalled();
    expect(
      core.renderToolCalls.find((item) => item.name === "searchDocs"),
    ).toBeDefined();
  });
});
