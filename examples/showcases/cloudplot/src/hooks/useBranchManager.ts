"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  Branch,
  BranchState,
  CloudPlotAgentState,
  AgentMessage,
} from "@/types";

const BRANCHES_KEY = "cloudplot_branches";
const BRANCH_STATES_KEY = "cloudplot_branch_states";

// Stable default for SSR - no randomUUID() to avoid hydration mismatch
const SSR_DEFAULT_BRANCH: Branch = {
  id: "main",
  name: "main",
  createdAt: 0,
  threadId: "00000000-0000-0000-0000-000000000000", // Placeholder, replaced after mount
};

type BranchStorageSnapshot = {
  branches: Branch[];
  branchStates: Record<string, BranchState>;
};

function createFreshDefaultBranch(): Branch {
  return {
    id: "main",
    name: "main",
    createdAt: Date.now(),
    threadId: crypto.randomUUID(),
  };
}

function loadBranchStorageSnapshot(): BranchStorageSnapshot {
  try {
    const savedBranches = localStorage.getItem(BRANCHES_KEY);
    const branches = savedBranches
      ? (JSON.parse(savedBranches) as Branch[]).map((branch) => ({
          ...branch,
          threadId: branch.threadId || crypto.randomUUID(),
        }))
      : [createFreshDefaultBranch()];
    const savedStates = localStorage.getItem(BRANCH_STATES_KEY);
    const branchStates = savedStates
      ? (JSON.parse(savedStates) as Record<string, BranchState>)
      : {};

    return { branches, branchStates };
  } catch {
    return {
      branches: [createFreshDefaultBranch()],
      branchStates: {},
    };
  }
}

export function useBranchManager() {
  // Start with SSR-safe defaults
  const [branches, setBranches] = useState<Branch[]>([SSR_DEFAULT_BRANCH]);
  const [branchStates, setBranchStates] = useState<Record<string, BranchState>>(
    {},
  );
  const [currentBranchId, setCurrentBranchId] = useState("main");
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    const snapshot = loadBranchStorageSnapshot();
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setBranches(snapshot.branches);
      setBranchStates(snapshot.branchStates);
      setIsHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist branches to localStorage (skip initial SSR state)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(BRANCHES_KEY, JSON.stringify(branches));
    }
  }, [branches, isHydrated]);

  // Persist branch states to localStorage
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(BRANCH_STATES_KEY, JSON.stringify(branchStates));
    }
  }, [branchStates, isHydrated]);

  // Save state for a specific branch
  const saveBranchState = useCallback(
    (
      branchId: string,
      state: CloudPlotAgentState,
      messages: AgentMessage[],
    ) => {
      setBranchStates((prev) => ({
        ...prev,
        [branchId]: { state, messages },
      }));
    },
    [],
  );

  // Get state for a specific branch (returns null if not saved yet)
  const getBranchState = useCallback(
    (branchId: string): BranchState | null => {
      return branchStates[branchId] || null;
    },
    [branchStates],
  );

  // Create a new branch with its own thread
  const createBranch = useCallback(
    (
      name: string,
      forkState?: { state: CloudPlotAgentState; messages: AgentMessage[] },
    ) => {
      const newBranch: Branch = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        threadId: crypto.randomUUID(), // New thread for new branch
      };
      setBranches((prev) => [...prev, newBranch]);

      // If forking, save the state for the new branch (for client-side backup)
      if (forkState) {
        setBranchStates((prev) => ({
          ...prev,
          [newBranch.id]: structuredClone(forkState),
        }));
      }

      setCurrentBranchId(newBranch.id);
      return newBranch;
    },
    [],
  );

  // Switch to a different branch
  const switchBranch = useCallback((branchId: string) => {
    setCurrentBranchId(branchId);
  }, []);

  const currentBranch = useMemo(
    () => branches.find((b) => b.id === currentBranchId) ?? branches[0],
    [branches, currentBranchId],
  );

  return {
    branches,
    currentBranch,
    currentBranchId,
    createBranch,
    switchBranch,
    saveBranchState,
    getBranchState,
    isHydrated,
  };
}
