// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BranchState, CloudPlotAgentState } from "@/types";
import CloudPlot from "./page";

const mocks = vi.hoisted(() => {
  const agentSetState = vi.fn();
  return {
    agentSetState,
    currentAgent: { setState: agentSetState },
    isReady: true,
    saveBranchState: vi.fn(),
    switchBranch: vi.fn(),
    getBranchState: vi.fn(),
    agentState: null as unknown as CloudPlotAgentState,
    branchManager: {
      branches: [
        {
          id: "main",
          name: "main",
          createdAt: 1,
          threadId: "saved-thread",
        },
      ],
      currentBranch: {
        id: "main",
        name: "main",
        createdAt: 1,
        threadId: "saved-thread",
      },
      currentBranchId: "main",
      createBranch: vi.fn(),
      switchBranch: vi.fn(),
      saveBranchState: vi.fn(),
      getBranchState: vi.fn(),
      isHydrated: true,
    },
  };
});

const emptyState: CloudPlotAgentState = {
  nodes: [],
  edges: [],
  logs: [],
  cost: 0,
  status: "idle",
  validation_errors: [],
};

const restoredState: CloudPlotAgentState = {
  ...emptyState,
  nodes: [
    {
      id: "vpc-saved",
      type: "vpc",
      label: "Saved VPC",
      config: { cidr_block: "10.0.0.0/16", subnets: [] },
      status: "healthy",
    },
  ],
};

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotChat: ({ threadId }: { threadId?: string }) => (
    <div data-testid="chat" data-thread-id={threadId} />
  ),
  CopilotChatConfigurationProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
}));

vi.mock("@/hooks/useCloudPlotAgent", () => ({
  useCloudPlotAgent: () => ({
    agent: mocks.currentAgent,
    state: mocks.agentState,
    isReady: mocks.isReady,
    appendMessage: vi.fn(),
  }),
}));

vi.mock("@/hooks/useBranchManager", () => ({
  useBranchManager: () => mocks.branchManager,
}));

vi.mock("@/hooks/useFrontendTools", () => ({ useFrontendTools: vi.fn() }));
vi.mock("@/hooks/useInfraApproval", () => ({ useInfraApproval: vi.fn() }));
vi.mock("@/components/Workspace", () => ({
  Workspace: () => <div data-testid="workspace" />,
}));
vi.mock("@/components/Header", () => ({
  Header: ({ onSwitchBranch }: { onSwitchBranch: (id: string) => void }) => (
    <button onClick={() => onSwitchBranch("alternate")}>Switch branch</button>
  ),
}));

describe("CloudPlot hydration and branch restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.branchManager.isHydrated = true;
    mocks.branchManager.switchBranch = mocks.switchBranch;
    mocks.branchManager.saveBranchState = mocks.saveBranchState;
    mocks.branchManager.getBranchState = mocks.getBranchState;
    mocks.currentAgent = { setState: mocks.agentSetState };
    mocks.isReady = true;
    mocks.agentState = structuredClone(restoredState);
    mocks.getBranchState.mockReturnValue({
      state: restoredState,
      messages: [],
    } satisfies BranchState);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("does not mount the workspace or chat before browser storage hydration", () => {
    mocks.branchManager.isHydrated = false;

    render(<CloudPlot />);

    expect(screen.getByText("Loading CloudPlot…")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
    expect(screen.queryByTestId("chat")).toBeNull();
  });

  it("mounts the saved thread and restores its state after hydration", async () => {
    render(<CloudPlot />);

    expect(screen.getByTestId("chat").dataset.threadId).toBe("saved-thread");
    await waitFor(() =>
      expect(mocks.agentSetState).toHaveBeenCalledWith(restoredState),
    );
  });

  it("applies the selected branch snapshot without a timer race", () => {
    const alternate = {
      state: { ...restoredState, cost: 99 },
      messages: [],
    } satisfies BranchState;
    mocks.switchBranch.mockReturnValue(alternate);

    render(<CloudPlot />);
    mocks.agentSetState.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Switch branch" }));

    expect(mocks.agentSetState).toHaveBeenCalledWith(alternate.state);
  });

  it("persists an intentionally emptied workspace", () => {
    vi.useFakeTimers();
    const view = render(<CloudPlot />);
    mocks.saveBranchState.mockClear();

    mocks.agentState = structuredClone(emptyState);
    view.rerender(<CloudPlot />);
    act(() => vi.advanceTimersByTime(500));

    expect(mocks.saveBranchState).toHaveBeenCalledWith("main", emptyState, []);
  });

  it("does not persist the agent's empty state before restoration", () => {
    vi.useFakeTimers();
    mocks.agentState = structuredClone(emptyState);

    render(<CloudPlot />);
    act(() => vi.advanceTimersByTime(500));

    expect(mocks.agentSetState).toHaveBeenCalledWith(restoredState);
    expect(mocks.saveBranchState).not.toHaveBeenCalled();
  });

  it("restores the saved snapshot when a provisional agent is replaced", () => {
    vi.useFakeTimers();
    const provisionalSetState = vi.fn();
    const realSetState = vi.fn();
    mocks.currentAgent = { setState: provisionalSetState };
    mocks.isReady = false;
    mocks.agentState = structuredClone(emptyState);
    const view = render(<CloudPlot />);

    act(() => vi.advanceTimersByTime(500));
    expect(provisionalSetState).not.toHaveBeenCalled();
    expect(mocks.saveBranchState).not.toHaveBeenCalled();

    mocks.currentAgent = { setState: realSetState };
    mocks.isReady = true;
    view.rerender(<CloudPlot />);

    expect(realSetState).toHaveBeenCalledWith(restoredState);
    expect(mocks.saveBranchState).not.toHaveBeenCalledWith(
      "main",
      emptyState,
      [],
    );
  });
});
