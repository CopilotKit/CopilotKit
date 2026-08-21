// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BranchState, CloudPlotAgentState } from "@/types";
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
afterEach(cleanup);

describe("useBranchManager", () => {
  it("keeps storage out of SSR, then recovers it at the client hydration boundary", async () => {
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

    function ServerSnapshot() {
      const manager = useBranchManager();
      return (
        <span>
          {`${manager.isHydrated ? "hydrated" : "server"}:${manager.currentBranch.threadId}`}
        </span>
      );
    }
    const serverHtml = renderToString(<ServerSnapshot />);
    expect(serverHtml).toContain("server:00000000-0000-0000-0000-000000000000");
    expect(serverHtml).not.toContain("saved-thread");
    expect(localStorage.getItem("cloudplot_branches")).toBe(serializedBranches);

    const manager = renderHook(() => useBranchManager());
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

  it("falls back when stored JSON has an invalid branch shape", async () => {
    localStorage.setItem("cloudplot_branches", JSON.stringify([]));
    localStorage.setItem(
      "cloudplot_branch_states",
      JSON.stringify({ stale: { state: stateA, messages: [] } }),
    );

    const manager = renderHook(() => useBranchManager());
    await waitFor(() => expect(manager.result.current.isHydrated).toBe(true));

    expect(manager.result.current.currentBranch).toMatchObject({
      id: "main",
      name: "main",
    });
    expect(manager.result.current.getBranchState("stale")).toBeNull();
  });

  it("forks an independent state with a distinct thread and recovers it from localStorage", async () => {
    const first = renderHook(() => useBranchManager());
    await waitFor(() => expect(first.result.current.isHydrated).toBe(true));
    const forkSource = structuredClone(stateA);

    let branchId = "";
    act(() => {
      branchId = first.result.current.createBranch("experiment", {
        state: forkSource,
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

    forkSource.nodes.length = 0;
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

  it("returns the saved branch state synchronously when switching", async () => {
    const manager = renderHook(() => useBranchManager());
    await waitFor(() => expect(manager.result.current.isHydrated).toBe(true));
    const savedState = structuredClone(stateA);
    savedState.nodes = [
      {
        id: "vpc-a",
        type: "vpc",
        label: "VPC A",
        config: { cidr_block: "10.0.0.0/16", subnets: [] },
        status: "healthy",
      },
    ];

    let branchId = "";
    act(() => {
      branchId = manager.result.current.createBranch("saved", {
        state: savedState,
        messages: [],
      }).id;
      manager.result.current.switchBranch("main");
    });

    const selectedResult: { current: BranchState | null } = { current: null };
    act(() => {
      selectedResult.current = manager.result.current.switchBranch(branchId);
    });

    const selected = selectedResult.current;
    if (!selected) throw new Error("Saved branch state was not returned");
    expect(selected.state.nodes.map((node) => node.id)).toEqual(["vpc-a"]);
    expect(manager.result.current.currentBranchId).toBe(branchId);
  });
});
