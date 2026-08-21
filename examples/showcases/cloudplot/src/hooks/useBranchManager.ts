"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import type {
  AgentMessage,
  Branch,
  BranchState,
  CloudPlotAgentState,
} from "@/types";

const BRANCHES_KEY = "cloudplot_branches";
const BRANCH_STATES_KEY = "cloudplot_branch_states";
const CURRENT_BRANCH_KEY = "cloudplot_current_branch";

const SSR_DEFAULT_BRANCH: Branch = {
  id: "main",
  name: "main",
  createdAt: 0,
  threadId: "00000000-0000-0000-0000-000000000000",
};

type BranchManagerSnapshot = {
  branches: Branch[];
  branchStates: Record<string, BranchState>;
  currentBranchId: string;
  isHydrated: boolean;
};

type BranchStore = {
  getSnapshot: () => BranchManagerSnapshot;
  getServerSnapshot: () => BranchManagerSnapshot;
  subscribe: (listener: () => void) => () => void;
  update: (
    updateSnapshot: (snapshot: BranchManagerSnapshot) => BranchManagerSnapshot,
  ) => void;
};

type StoredBranch = Omit<Branch, "threadId"> & { threadId?: string };

const SSR_SNAPSHOT: BranchManagerSnapshot = {
  branches: [SSR_DEFAULT_BRANCH],
  branchStates: {},
  currentBranchId: "main",
  isHydrated: false,
};

function createFreshDefaultBranch(): Branch {
  return {
    id: "main",
    name: "main",
    createdAt: Date.now(),
    threadId: crypto.randomUUID(),
  };
}

function isStoredBranch(value: unknown): value is StoredBranch {
  if (!value || typeof value !== "object") return false;
  const branch = value as Partial<Branch>;
  return (
    typeof branch.id === "string" &&
    branch.id.length > 0 &&
    typeof branch.name === "string" &&
    branch.name.length > 0 &&
    typeof branch.createdAt === "number" &&
    Number.isFinite(branch.createdAt) &&
    (branch.threadId === undefined || typeof branch.threadId === "string")
  );
}

function isBranchStateRecord(
  value: unknown,
): value is Record<string, BranchState> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(isBranchState)
  );
}

function isBranchState(value: unknown): value is BranchState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const branchState = value as Partial<BranchState>;
  return (
    isCloudPlotAgentState(branchState.state) &&
    Array.isArray(branchState.messages)
  );
}

function isCloudPlotAgentState(value: unknown): value is CloudPlotAgentState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<CloudPlotAgentState>;
  return (
    Array.isArray(state.nodes) &&
    Array.isArray(state.edges) &&
    Array.isArray(state.logs) &&
    typeof state.cost === "number" &&
    Number.isFinite(state.cost) &&
    (state.status === "idle" ||
      state.status === "designing" ||
      state.status === "validating") &&
    Array.isArray(state.validation_errors)
  );
}

function loadBranchStorageSnapshot(): Pick<
  BranchManagerSnapshot,
  "branches" | "branchStates" | "currentBranchId"
> {
  try {
    const savedBranches = localStorage.getItem(BRANCHES_KEY);
    const parsedBranches: unknown = savedBranches
      ? JSON.parse(savedBranches)
      : null;
    if (
      savedBranches &&
      (!Array.isArray(parsedBranches) ||
        parsedBranches.length === 0 ||
        !parsedBranches.every(isStoredBranch))
    ) {
      throw new Error("Invalid stored branch data");
    }
    const branches = Array.isArray(parsedBranches)
      ? parsedBranches.map((branch) => ({
          ...branch,
          threadId: branch.threadId || crypto.randomUUID(),
        }))
      : [createFreshDefaultBranch()];
    const savedStates = localStorage.getItem(BRANCH_STATES_KEY);
    const parsedStates: unknown = savedStates ? JSON.parse(savedStates) : {};
    if (!isBranchStateRecord(parsedStates)) {
      throw new Error("Invalid stored branch state data");
    }
    const savedCurrentBranchId = localStorage.getItem(CURRENT_BRANCH_KEY);
    const currentBranchId =
      savedCurrentBranchId !== null &&
      branches.some((branch) => branch.id === savedCurrentBranchId)
        ? savedCurrentBranchId
        : (branches[0]?.id ?? "main");

    return { branches, branchStates: parsedStates, currentBranchId };
  } catch {
    const branch = createFreshDefaultBranch();
    return {
      branches: [branch],
      branchStates: {},
      currentBranchId: branch.id,
    };
  }
}

function persistSnapshot(snapshot: BranchManagerSnapshot): void {
  if (!snapshot.isHydrated) return;
  localStorage.setItem(BRANCHES_KEY, JSON.stringify(snapshot.branches));
  localStorage.setItem(
    BRANCH_STATES_KEY,
    JSON.stringify(snapshot.branchStates),
  );
  localStorage.setItem(CURRENT_BRANCH_KEY, snapshot.currentBranchId);
}

function createBranchStore(): BranchStore {
  let snapshot = SSR_SNAPSHOT;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((listener) => listener());
  const hydrate = () => {
    if (snapshot.isHydrated) return;
    const stored = loadBranchStorageSnapshot();
    snapshot = {
      ...stored,
      isHydrated: true,
    };
    persistSnapshot(snapshot);
    emit();
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SSR_SNAPSHOT,
    subscribe: (listener) => {
      listeners.add(listener);
      hydrate();
      return () => listeners.delete(listener);
    },
    update: (updateSnapshot) => {
      snapshot = updateSnapshot(snapshot);
      persistSnapshot(snapshot);
      emit();
    },
  };
}

export function useBranchManager() {
  const [store] = useState(createBranchStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const saveBranchState = useCallback(
    (
      branchId: string,
      state: CloudPlotAgentState,
      messages: AgentMessage[],
    ) => {
      store.update((current) => ({
        ...current,
        branchStates: {
          ...current.branchStates,
          [branchId]: { state, messages },
        },
      }));
    },
    [store],
  );

  const getBranchState = useCallback(
    (branchId: string): BranchState | null =>
      store.getSnapshot().branchStates[branchId] || null,
    [store],
  );

  const createBranch = useCallback(
    (
      name: string,
      forkState?: { state: CloudPlotAgentState; messages: AgentMessage[] },
    ) => {
      const newBranch: Branch = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        threadId: crypto.randomUUID(),
      };
      store.update((current) => ({
        ...current,
        branches: [...current.branches, newBranch],
        branchStates: forkState
          ? {
              ...current.branchStates,
              [newBranch.id]: structuredClone(forkState),
            }
          : current.branchStates,
        currentBranchId: newBranch.id,
      }));
      return newBranch;
    },
    [store],
  );

  const switchBranch = useCallback(
    (branchId: string): BranchState | null => {
      const branchState = store.getSnapshot().branchStates[branchId] || null;
      store.update((current) => ({ ...current, currentBranchId: branchId }));
      return branchState;
    },
    [store],
  );

  const currentBranch =
    snapshot.branches.find(
      (branch) => branch.id === snapshot.currentBranchId,
    ) ?? snapshot.branches[0];

  return {
    branches: snapshot.branches,
    currentBranch,
    currentBranchId: snapshot.currentBranchId,
    createBranch,
    switchBranch,
    saveBranchState,
    getBranchState,
    isHydrated: snapshot.isHydrated,
  };
}
