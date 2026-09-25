import { StrictMode, useContext } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontendTool } from "@copilotkit/core";
import { AutopilotProvider } from "../AutopilotProvider";
import type { CopilotAutopilotConfig } from "../AutopilotProvider";
import { AutopilotContext } from "../context";

const state = vi.hoisted(() => ({
  tools: new Map<string, FrontendTool>(),
  contexts: new Set<string>(),
}));
const core = vi.hoisted(() => ({
  getTool: ({ toolName }: { toolName: string }) => state.tools.get(toolName),
  addTool: (tool: FrontendTool) => state.tools.set(tool.name, tool),
  removeTool: (name: string) => state.tools.delete(name),
  addHookRenderToolCall: vi.fn(),
  removeHookRenderToolCall: vi.fn(),
  addContext: () => {
    const id = String(state.contexts.size + 1);
    state.contexts.add(id);
    return id;
  },
  removeContext: (id: string) => state.contexts.delete(id),
  isAutopilotEnabledForAgent: () => true,
}));
vi.mock("../../context", () => ({
  useCopilotKit: () => ({ copilotkit: core }),
}));

const config: CopilotAutopilotConfig = {
  adapter: {
    identity: { userId: "user", organizationId: "organization" },
    navigation: {
      push: vi.fn(),
      mayLeave: () => true,
      allowedPath: () => true,
    },
    canWrite: async () => true,
  },
};
let controllers: NonNullable<React.ContextType<typeof AutopilotContext>>;
function Consumer() {
  const context = useContext(AutopilotContext)!;
  controllers = context;
  return <div>{context.statusNotice?.message ?? "ready"}</div>;
}
beforeEach(() => {
  state.tools.clear();
  state.contexts.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("Autopilot installation", () => {
  it("installs one catalog in StrictMode, keeps it stable across rerenders and cleans up", () => {
    const view = render(
      <StrictMode>
        <AutopilotProvider config={config}>
          <Consumer />
        </AutopilotProvider>
      </StrictMode>,
    );
    expect(state.tools.size).toBe(8);
    expect(state.tools.has("describeVisiblePage")).toBe(false);
    expect([...state.tools.values()].every((tool) => tool.autopilot)).toBe(
      true,
    );
    expect(state.contexts.size).toBe(1);
    const read = state.tools.get("autopilot_readPage");
    view.rerender(
      <StrictMode>
        <AutopilotProvider config={{ ...config }}>
          <Consumer />
        </AutopilotProvider>
      </StrictMode>,
    );
    expect(state.tools.get("autopilot_readPage")).toBe(read);
    view.unmount();
    expect(state.tools.size).toBe(0);
    expect(state.contexts.size).toBe(0);
  });
  it("cancels a pending human decision when scope changes or the provider unmounts", async () => {
    const view = render(
      <AutopilotProvider config={config}>
        <Consumer />
      </AutopilotProvider>,
    );
    let approval!: Promise<unknown>;
    act(() => {
      approval = controllers.approvalController.request({
        description: "Change?",
        agentId: "agent",
        threadId: "thread",
      });
    });
    view.rerender(
      <AutopilotProvider config={{ ...config, enabled: false }}>
        <Consumer />
      </AutopilotProvider>,
    );
    expect(await approval).toBe("cancelled");
    let clarification!: Promise<unknown>;
    act(() => {
      clarification = controllers.clarificationController.request({
        question: "Which item?",
        agentId: "agent",
        threadId: "thread",
      });
    });
    view.unmount();
    expect(await clarification).toEqual({ status: "cancelled" });
  });
  it("restores only the current identity's uncertain outcome without exposing field values", () => {
    sessionStorage.setItem(
      "copilotkit:autopilot:unsettled:organization:user",
      "pending",
    );
    const view = render(
      <AutopilotProvider config={config}>
        <Consumer />
      </AutopilotProvider>,
    );
    expect(screen.getByText(/Outcome unconfirmed/)).toBeTruthy();
    view.rerender(
      <AutopilotProvider
        config={{
          ...config,
          adapter: {
            ...config.adapter!,
            identity: { userId: "other", organizationId: "organization" },
          },
        }}
      >
        <Consumer />
      </AutopilotProvider>,
    );
    expect(screen.getByText("ready")).toBeTruthy();
    view.unmount();
  });
});
