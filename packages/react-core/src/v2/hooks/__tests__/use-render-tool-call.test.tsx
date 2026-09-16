import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolCall } from "@ag-ui/core";

import type { ReactToolCallRenderer } from "../../types/react-tool-call-renderer";
import type { DefaultRenderProps } from "../use-default-render-tool";
import { useRenderToolCall } from "../use-render-tool-call";
import { useRenderTool } from "../use-render-tool";
import { useDefaultRenderTool } from "../use-default-render-tool";
import { useCopilotKit } from "../../context";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

// Drive the REAL useDefaultRenderTool -> useRenderTool registration through
// the REAL useRenderToolCall resolver. Only the surrounding context
// (provider core + chat configuration) is mocked, so these tests assert the
// end-to-end rendering contract rather than registration internals.
vi.mock("../../context", () => ({ useCopilotKit: vi.fn() }));
vi.mock("../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseChatConfig = useCopilotChatConfiguration as ReturnType<
  typeof vi.fn
>;

/**
 * Minimal CopilotKit core stand-in. `renderToolCalls` returns a STABLE array
 * reference between mutations (required by useSyncExternalStore — a fresh
 * array each read would trip the "getSnapshot should be cached" loop) and
 * notifies subscribers whenever a renderer is registered/removed so the
 * resolver re-renders after the hook's registration effect fires.
 */
function createNotifyingCore() {
  const entries = new Map<string, ReactToolCallRenderer>();
  const subscribers = new Set<() => void>();
  let snapshot: ReactToolCallRenderer[] = [];
  const refresh = () => {
    snapshot = Array.from(entries.values());
  };
  const emit = () => subscribers.forEach((cb) => cb());
  return {
    get renderToolCalls() {
      return snapshot;
    },
    addHookRenderToolCall(renderer: ReactToolCallRenderer) {
      entries.set(`${renderer.agentId ?? ""}:${renderer.name}`, renderer);
      refresh();
      emit();
    },
    removeHookRenderToolCall(name: string, agentId?: string) {
      entries.delete(`${agentId ?? ""}:${name}`);
      refresh();
      emit();
    },
    subscribe(handlers: { onRenderToolCallsChanged?: () => void }) {
      const cb = handlers.onRenderToolCallsChanged ?? (() => {});
      subscribers.add(cb);
      return { unsubscribe: () => subscribers.delete(cb) };
    },
  };
}

const toolCall: ToolCall = {
  id: "tc-1",
  type: "function",
  function: { name: "generate_a2ui", arguments: "{}" },
};

// Resolves and renders the tool call using the production resolver.
function ResolverProbe() {
  const renderToolCall = useRenderToolCall();
  return <>{renderToolCall({ toolCall })}</>;
}

describe("useRenderToolCall — opt-in default tool-call rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChatConfig.mockReturnValue(null);
    mockUseCopilotKit.mockReturnValue({
      copilotkit: createNotifyingCore(),
      executingToolCallIds: new Set<string>(),
    });
  });

  // Scenario 1: hook on, no render arg -> built-in default debug card.
  it("renders the built-in default card when useDefaultRenderTool() is called", async () => {
    function Harness() {
      useDefaultRenderTool();
      return <ResolverProbe />;
    }

    render(<Harness />);

    expect(await screen.findByTestId("copilot-tool-render")).toBeDefined();
    expect(screen.getByTestId("copilot-tool-render-name").textContent).toBe(
      "generate_a2ui",
    );
  });

  // Scenario 2: hook on, with render -> the caller's custom UI (and NOT the
  // built-in card).
  it("renders the caller's custom UI when useDefaultRenderTool({ render }) is called", async () => {
    function Harness() {
      useDefaultRenderTool({
        render: ({ name }: DefaultRenderProps) => (
          <div data-testid="custom-card">{name}</div>
        ),
      });
      return <ResolverProbe />;
    }

    render(<Harness />);

    const custom = await screen.findByTestId("custom-card");
    expect(custom.textContent).toBe("generate_a2ui");
    // The built-in card must not also render.
    expect(screen.queryByTestId("copilot-tool-render")).toBeNull();
  });

  // Scenario 3: no hook -> nothing renders (no leaked card in production).
  it("renders nothing when no renderer is registered", () => {
    function Harness() {
      return <ResolverProbe />;
    }

    const { container } = render(<Harness />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("copilot-tool-render")).toBeNull();
  });
});
/**
 * The unmatched-tool-call warning is reported from a `setTimeout(..., 0)` so it
 * lands after every effect in the tree, which is what keeps it from firing
 * against a registry that has not settled yet. Tests must therefore let one
 * macrotask elapse before asserting.
 */
async function flushWarningTask(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useRenderToolCall — reporting a tool call that renders nothing", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChatConfig.mockReturnValue(null);
    mockUseCopilotKit.mockReturnValue({
      copilotkit: createNotifyingCore(),
      executingToolCallIds: new Set<string>(),
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("names the unmatched tool and the renderers that are registered", async () => {
    function Harness() {
      useRenderTool(
        { name: "searchDocs", parameters: z.object({}), render: () => <div /> },
        [],
      );
      return <ResolverProbe />;
    }

    render(<Harness />);
    await flushWarningTask();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('"generate_a2ui"');
    expect(message).toContain('Registered renderers: "searchDocs"');
    expect(message).toContain("useDefaultRenderTool()");
  });

  it("says so explicitly when no renderers are registered at all", async () => {
    render(<ResolverProbe />);
    await flushWarningTask();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "No tool-call renderers are registered",
    );
  });

  // The registration effect lives in the component that renders the chat, and
  // React runs child effects before parent ones — so the resolver's own effect
  // sees an empty registry on the first commit even though the app did register
  // a renderer. Warning at effect time would make this case a false positive.
  it("stays silent when the app's renderer registers after the resolver's effect", async () => {
    function Harness() {
      useDefaultRenderTool();
      return <ResolverProbe />;
    }

    render(<Harness />);
    expect(await screen.findByTestId("copilot-tool-render")).toBeDefined();
    await flushWarningTask();

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when a wildcard renderer covers the call", async () => {
    function Harness() {
      useRenderTool({ name: "*", render: () => <div data-testid="any" /> }, []);
      return <ResolverProbe />;
    }

    render(<Harness />);
    expect(await screen.findByTestId("any")).toBeDefined();
    await flushWarningTask();

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per tool name, not once per render", async () => {
    function Harness() {
      const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
      React.useEffect(() => {
        forceRender();
      }, []);
      return <ResolverProbe />;
    }

    render(<Harness />);
    await flushWarningTask();
    await flushWarningTask();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
