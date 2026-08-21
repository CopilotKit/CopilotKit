// @vitest-environment jsdom

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
  it("keeps the SSR branch for the first render, then recovers the stored snapshot", async () => {
    const storedBranches = [
      {
        id: "saved",
        name: "saved",
        createdAt: 123,
        threadId: "saved-thread",
      },
    ];
    const storedStates = {
      saved: { state: stateA, messages: [] },
    };
    const serializedBranches = JSON.stringify(storedBranches);
    localStorage.setItem("cloudplot_branches", serializedBranches);
    localStorage.setItem(
      "cloudplot_branch_states",
      JSON.stringify(storedStates),
    );

    const manager = renderHook(() => useBranchManager());

    expect(manager.result.current.isHydrated).toBe(false);
    expect(manager.result.current.branches).toEqual([
      {
        id: "main",
        name: "main",
        createdAt: 0,
        threadId: "00000000-0000-0000-0000-000000000000",
      },
    ]);
    expect(manager.result.current.getBranchState("saved")).toBeNull();
    expect(localStorage.getItem("cloudplot_branches")).toBe(serializedBranches);

    await waitFor(() => expect(manager.result.current.isHydrated).toBe(true));
    expect(manager.result.current.branches).toEqual(storedBranches);
    expect(
      manager.result.current
        .getBranchState("saved")
        ?.state.nodes.map((node) => node.id),
    ).toEqual(["vpc-a"]);
  });

  it("migrates a stored branch that predates thread IDs", async () => {
    localStorage.setItem(
      "cloudplot_branches",
      JSON.stringify([{ id: "main", name: "main", createdAt: 123 }]),
    );

    const manager = renderHook(() => useBranchManager());
    await waitFor(() => expect(manager.result.current.isHydrated).toBe(true));

    expect(manager.result.current.branches[0]).toMatchObject({
      id: "main",
      name: "main",
      createdAt: 123,
    });
    expect(manager.result.current.branches[0].threadId).toEqual(
      expect.any(String),
    );
    expect(manager.result.current.branches[0].threadId).not.toHaveLength(0);
    await waitFor(() =>
      expect(localStorage.getItem("cloudplot_branches")).toContain(
        manager.result.current.branches[0].threadId,
      ),
    );
  });

  it("falls back to a fresh branch and empty state when storage is corrupt", async () => {
    localStorage.setItem("cloudplot_branches", "{not-json");
    localStorage.setItem(
      "cloudplot_branch_states",
      JSON.stringify({ stale: { state: stateA, messages: [] } }),
    );

    const manager = renderHook(() => useBranchManager());
    await waitFor(() => expect(manager.result.current.isHydrated).toBe(true));

    expect(manager.result.current.branches).toHaveLength(1);
    expect(manager.result.current.branches[0]).toMatchObject({
      id: "main",
      name: "main",
    });
    expect(manager.result.current.branches[0].createdAt).toBeGreaterThan(0);
    expect(manager.result.current.branches[0].threadId).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(manager.result.current.getBranchState("stale")).toBeNull();
    await waitFor(() =>
      expect(localStorage.getItem("cloudplot_branches")).not.toBe("{not-json"),
    );
  });

  it("forks an independent state with a distinct thread and recovers it from localStorage", async () => {
    const first = renderHook(() => useBranchManager());
    await waitFor(() => expect(first.result.current.isHydrated).toBe(true));

    let branchId = "";
    act(() => {
      branchId = first.result.current.createBranch("experiment", {
        state: stateA,
        messages: [],
      }).id;
    });

    const fork = first.result.current.branches.find(
      (branch) => branch.id === branchId,
    );
    expect(fork?.threadId).not.toBe(first.result.current.branches[0].threadId);
    expect(
      first.result.current
        .getBranchState(branchId)
        ?.state.nodes.map((node) => node.id),
    ).toEqual(["vpc-a"]);

    stateA.nodes.length = 0;
    expect(
      first.result.current
        .getBranchState(branchId)
        ?.state.nodes.map((node) => node.id),
    ).toEqual(["vpc-a"]);

    await waitFor(() =>
      expect(localStorage.getItem("cloudplot_branch_states")).toContain(
        branchId,
      ),
    );
    first.unmount();

    const recovered = renderHook(() => useBranchManager());
    await waitFor(() => expect(recovered.result.current.isHydrated).toBe(true));
    expect(
      recovered.result.current.branches.some(
        (branch) => branch.id === branchId,
      ),
    ).toBe(true);
    expect(
      recovered.result.current
        .getBranchState(branchId)
        ?.state.nodes.map((node) => node.id),
    ).toEqual(["vpc-a"]);
  });

  it("starts with no recovered experiment in a fresh profile", async () => {
    localStorage.clear();
    const fresh = renderHook(() => useBranchManager());
    await waitFor(() => expect(fresh.result.current.isHydrated).toBe(true));

    expect(fresh.result.current.branches).toHaveLength(1);
    expect(fresh.result.current.getBranchState("experiment")).toBeNull();
  });
});
