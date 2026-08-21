"use client";

import { useEffect, useRef, useCallback } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useCloudPlotAgent } from "@/hooks/useCloudPlotAgent";
import { useBranchManager } from "@/hooks/useBranchManager";
import { useFrontendTools } from "@/hooks/useFrontendTools";
import { useInfraApproval } from "@/hooks/useInfraApproval";
import { Header } from "@/components/Header";
import { Workspace } from "@/components/Workspace";

export default function CloudPlot() {
  const { agent, state, appendMessage } = useCloudPlotAgent();
  const {
    branches,
    currentBranch,
    currentBranchId,
    createBranch,
    switchBranch,
    saveBranchState,
    getBranchState,
  } = useBranchManager();

  // Register CopilotKit tools
  useFrontendTools();
  useInfraApproval();

  // Track previous threadId to detect branch switches
  const prevThreadIdRef = useRef(currentBranch.threadId);

  // Restore state when threadId changes (after branch switch/create completes)
  // Delay to let CopilotKit finish its internal initialization first
  useEffect(() => {
    if (prevThreadIdRef.current !== currentBranch.threadId) {
      prevThreadIdRef.current = currentBranch.threadId;

      // Load saved state for this branch
      const branchState = getBranchState(currentBranchId);
      if (branchState) {
        // Delay to let CopilotKit initialize the new thread first
        const timeout = setTimeout(() => {
          agent.setState(branchState.state);
        }, 300);
        return () => clearTimeout(timeout);
      }
    }
  }, [currentBranch.threadId, currentBranchId, getBranchState, agent]);

  // Debounced auto-save (mem-0033)
  useEffect(() => {
    // Skip empty state to avoid overwriting saved data on initial load
    if (!state || !state.nodes?.length) return;

    const timer = setTimeout(() => {
      saveBranchState(currentBranchId, state, []);
    }, 500);

    return () => clearTimeout(timer);
  }, [state, currentBranchId, saveBranchState]);

  // Branch creation handler - forks current state
  const handleCreateBranch = useCallback(
    (name: string) => {
      // Save current state to current branch first
      saveBranchState(currentBranchId, state, []);

      // Create new branch with forked state (deep clone)
      const forkState = {
        state: structuredClone(state),
        messages: [],
      };
      createBranch(name, forkState);
    },
    [currentBranchId, state, saveBranchState, createBranch]
  );

  // Branch switching handler - saves current state before switching
  const handleSwitchBranch = useCallback(
    (branchId: string) => {
      if (branchId === currentBranchId) return;

      // Save current branch state before switching
      saveBranchState(currentBranchId, state, []);

      // Switch to new branch (useEffect will restore state after threadId changes)
      switchBranch(branchId);
    },
    [currentBranchId, state, saveBranchState, switchBranch]
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header
        branches={branches}
        currentBranch={currentBranch}
        onCreateBranch={handleCreateBranch}
        onSwitchBranch={handleSwitchBranch}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* CENTER - Workspace */}
        <Workspace
          resources={state?.nodes || []}
          edges={state?.edges || []}
          cost={state?.cost || 0}
          onSelectPill={appendMessage}
        />

        {/* RIGHT - Chat Sidebar */}
        <div className="w-[28rem] border-l bg-white flex flex-col">
          <CopilotChat
            className="flex-1 min-h-0 p-4"
            agentId="cloudplot_agent"
            threadId={currentBranch.threadId}
            labels={{
              chatInputPlaceholder: "Describe your infrastructure",
            }}
          />
        </div>
      </div>
    </div>
  );
}
