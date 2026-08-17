import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderTool } from "../use-render-tool";
import type { RenderToolProps } from "../use-render-tool";
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

/**
 * Paints a registered renderer entry the way the chat would — as a component,
 * at `complete` status — and returns the text it produced.
 */
function paintCompleted(
  renderer: ReactToolCallRenderer,
  args: Record<string, unknown>,
): string {
  const Registered = renderer.render as React.FC<Record<string, unknown>>;
  const ui = render(
    <Registered
      name={renderer.name}
      toolCallId="tc-1"
      args={args}
      status={ToolCallStatus.Complete}
      result="done"
    />,
  );
  return ui.container.textContent ?? "";
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
    const args = renderer?.args;
    if (!(args instanceof z.ZodType)) {
      throw new Error("expected wildcard args to default to a zod schema");
    }
    expect(args.safeParse({ arbitrary: true }).success).toBe(true);
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

  it("PINS the limitation: a non-serialisable dep can never re-register", () => {
    // `useRenderTool` compares deps with `JSON.stringify(extraDeps)` (the last
    // entry of its effect's dependency array), so a function / Map / Set / class
    // instance with private fields collapses to a CONSTANT and cannot trigger
    // re-registration however often its identity changes. `use-frontend-tool.tsx`
    // has the same comparator and the same edge.
    //
    // This records a documented sharp edge, NOT behaviour worth keeping. It is
    // pinned so that changing the comparator (e.g. to reference equality) fails
    // loudly here and forces the hook's JSDoc — which tells callers to pass what
    // their render closes over in `deps` — to be corrected along with it. Do not
    // read this test as a guarantee to preserve.
    const core = createMockCore();
    mockUseCopilotKit.mockReturnValue({ copilotkit: core });

    const Harness: React.FC<{ label: string }> = ({ label }) => {
      useRenderTool(
        {
          name: "searchDocs",
          parameters: z.object({ query: z.string() }),
          render: () => <div>{label}</div>,
        },
        // A FRESH function identity on every render. `JSON.stringify` flattens
        // it to the constant `"[null]"`, so the effect never sees it change.
        [() => label],
      );
      return null;
    };

    const ui = render(<Harness label="before" />);
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(1);
    const registeredBefore = core.renderToolCalls.find(
      (item) => item.name === "searchDocs",
    )!.render;

    ui.rerender(<Harness label="after" />);

    // No second registration, and the entry still holds the FIRST closure…
    expect(core.addHookRenderToolCall).toHaveBeenCalledTimes(1);
    expect(
      core.renderToolCalls.find((item) => item.name === "searchDocs")!.render,
    ).toBe(registeredBefore);

    // …which is the consequence that actually bites: the chat keeps painting the
    // stale label. Compare "re-registers when deps change" above, where a
    // serialisable dep does re-register.
    expect(
      paintCompleted(
        core.renderToolCalls.find((item) => item.name === "searchDocs")!,
        { query: "invoices" },
      ),
    ).toBe("before");
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

  describe("what a render may return", () => {
    // `render` is typed `=> React.ReactElement | null`, so an author can choose
    // to draw nothing for a tool call. Both directions are asserted, because a
    // one-directional test would still pass if the element path had broken.

    it("registers a render that returns null, and paints nothing", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const silentRender = vi.fn(
        (_props: RenderToolProps<z.ZodObject<{ query: z.ZodString }>>) => null,
      );

      const Harness: React.FC = () => {
        useRenderTool(
          {
            name: "silentTool",
            parameters: z.object({ query: z.string() }),
            render: silentRender,
          },
          [],
        );
        return null;
      };

      render(<Harness />);

      const renderer = core.renderToolCalls.find(
        (item) => item.name === "silentTool",
      );
      expect(renderer).toBeDefined();
      expect(paintCompleted(renderer!, { query: "invoices" })).toBe("");
      // Nothing was painted BECAUSE the render ran and chose null, not because
      // the registration never reached it.
      expect(silentRender).toHaveBeenCalledTimes(1);
    });

    it("still registers a render that returns an element, and paints it", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const Harness: React.FC = () => {
        useRenderTool(
          {
            name: "loudTool",
            parameters: z.object({ query: z.string() }),
            render: ({ parameters }) => <div>found {parameters.query}</div>,
          },
          [],
        );
        return null;
      };

      render(<Harness />);

      const renderer = core.renderToolCalls.find(
        (item) => item.name === "loudTool",
      );
      expect(renderer).toBeDefined();
      expect(paintCompleted(renderer!, { query: "invoices" })).toBe(
        "found invoices",
      );
    });

    it("registers a wildcard render that returns null, and paints nothing", () => {
      const core = createMockCore();
      mockUseCopilotKit.mockReturnValue({ copilotkit: core });

      const silentWildcard = vi.fn(() => null);

      const Harness: React.FC = () => {
        useRenderTool({ name: "*", render: silentWildcard }, []);
        return null;
      };

      render(<Harness />);

      const renderer = core.renderToolCalls.find((item) => item.name === "*");
      expect(renderer).toBeDefined();
      expect(paintCompleted(renderer!, { anything: "goes" })).toBe("");
      expect(silentWildcard).toHaveBeenCalledTimes(1);
    });
  });
});
