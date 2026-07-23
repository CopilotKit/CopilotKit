import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolCall } from "@ag-ui/core";

import type { ReactToolCallRenderer } from "../../types/react-tool-call-renderer";
import type { DefaultRenderProps } from "../use-default-render-tool";
import { useRenderToolCall } from "../use-render-tool-call";
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
