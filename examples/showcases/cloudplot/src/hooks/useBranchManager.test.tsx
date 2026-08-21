import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { CloudPlotAgentState } from "@/types";
import { useBranchManager } from "./useBranchManager";

const stateA: CloudPlotAgentState = {
  nodes: [
    {
      id: "vpc-a",
      type: "vpc",
      label: "VPC A",
      config: { cidr_block: "10.0.0.0/16", subnets: [] },
      status: "healthy",
    },
  ],
  edges: [],
  logs: [],
  cost: 0,
  status: "idle",
  validation_errors: [],
};

beforeEach(() => localStorage.clear());

describe("useBranchManager", () => {
  it("forks an independent state with a distinct thread and recovers it from localStorage", async () => {
    const first = renderHook(() => useBranchManager());
    await waitFor(() => expect(first.result.current.isHydrated).toBe(true));

    let branchId = "";
    act(() => {
      branchId = first.result.current.createBranch("experiment", { state: stateA, messages: [] }).id;
    });

    const fork = first.result.current.branches.find((branch) => branch.id === branchId);
    expect(fork?.threadId).not.toBe(first.result.current.branches[0].threadId);
    expect(first.result.current.getBranchState(branchId)?.state.nodes.map((node) => node.id)).toEqual(["vpc-a"]);

    stateA.nodes.length = 0;
    expect(first.result.current.getBranchState(branchId)?.state.nodes.map((node) => node.id)).toEqual(["vpc-a"]);

    await waitFor(() => expect(localStorage.getItem("cloudplot_branch_states")).toContain(branchId));
    first.unmount();

    const recovered = renderHook(() => useBranchManager());
    await waitFor(() => expect(recovered.result.current.isHydrated).toBe(true));
    expect(recovered.result.current.branches.some((branch) => branch.id === branchId)).toBe(true);
    expect(recovered.result.current.getBranchState(branchId)?.state.nodes.map((node) => node.id)).toEqual(["vpc-a"]);
  });

  it("starts with no recovered experiment in a fresh profile", async () => {
    localStorage.clear();
    const fresh = renderHook(() => useBranchManager());
    await waitFor(() => expect(fresh.result.current.isHydrated).toBe(true));

    expect(fresh.result.current.branches).toHaveLength(1);
    expect(fresh.result.current.getBranchState("experiment")).toBeNull();
  });
});
