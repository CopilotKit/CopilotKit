"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Branch, BranchState, CloudPlotAgentState, AgentMessage } from "@/types";

const BRANCHES_KEY = "cloudplot_branches";
const BRANCH_STATES_KEY = "cloudplot_branch_states";

// Stable default for SSR - no randomUUID() to avoid hydration mismatch
const SSR_DEFAULT_BRANCH: Branch = {
  id: "main",
  name: "main",
  createdAt: 0,
  threadId: "00000000-0000-0000-0000-000000000000", // Placeholder, replaced after mount
};

export function useBranchManager() {
  // Start with SSR-safe defaults
  const [branches, setBranches] = useState<Branch[]>([SSR_DEFAULT_BRANCH]);
  const [branchStates, setBranchStates] = useState<Record<string, BranchState>>({});
  const [currentBranchId, setCurrentBranchId] = useState("main");
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    try {
      const savedBranches = localStorage.getItem(BRANCHES_KEY);
      if (savedBranches) {
        const parsed = JSON.parse(savedBranches) as Branch[];
        // Migrate: add threadId if missing (old format)
        const migrated = parsed.map((b) => ({
          ...b,
          threadId: b.threadId || crypto.randomUUID(),
        }));
        setBranches(migrated);
      } else {
        // No saved branches - create fresh default with real UUID
        const freshDefault: Branch = {
          id: "main",
          name: "main",
          createdAt: Date.now(),
          threadId: crypto.randomUUID(),
        };
        setBranches([freshDefault]);
      }

      const savedStates = localStorage.getItem(BRANCH_STATES_KEY);
      if (savedStates) {
        setBranchStates(JSON.parse(savedStates) as Record<string, BranchState>);
      }
    } catch {
      // localStorage error - create fresh default
      const freshDefault: Branch = {
        id: "main",
        name: "main",
        createdAt: Date.now(),
        threadId: crypto.randomUUID(),
      };
      setBranches([freshDefault]);
    }
    setIsHydrated(true);
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
    (branchId: string, state: CloudPlotAgentState, messages: AgentMessage[]) => {
      setBranchStates((prev) => ({
        ...prev,
        [branchId]: { state, messages },
      }));
    },
    []
  );

  // Get state for a specific branch (returns null if not saved yet)
  const getBranchState = useCallback(
    (branchId: string): BranchState | null => {
      return branchStates[branchId] || null;
    },
    [branchStates]
  );

  // Create a new branch with its own thread
  const createBranch = useCallback(
    (name: string, forkState?: { state: CloudPlotAgentState; messages: AgentMessage[] }) => {
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
          [newBranch.id]: forkState,
        }));
      }

      setCurrentBranchId(newBranch.id);
      return newBranch;
    },
    []
  );

  // Switch to a different branch
  const switchBranch = useCallback((branchId: string) => {
    setCurrentBranchId(branchId);
  }, []);

  const currentBranch = useMemo(
    () => branches.find((b) => b.id === currentBranchId) ?? branches[0],
    [branches, currentBranchId]
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
