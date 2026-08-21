"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { useCloudPlotAgent } from "@/hooks/useCloudPlotAgent";
import { useBranchManager } from "@/hooks/useBranchManager";
import { useFrontendTools } from "@/hooks/useFrontendTools";
import { useInfraApproval } from "@/hooks/useInfraApproval";
import { Header } from "@/components/Header";
import { Workspace } from "@/components/Workspace";

export default function CloudPlot() {
  const branchManager = useBranchManager();

  if (!branchManager.isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Loading CloudPlot…
      </div>
    );
  }

  return (
    <CopilotChatConfigurationProvider
      key={branchManager.currentBranch.threadId}
      agentId="cloudplot_agent"
      threadId={branchManager.currentBranch.threadId}
    >
      <CloudPlotWorkspace branchManager={branchManager} />
    </CopilotChatConfigurationProvider>
  );
}

function CloudPlotWorkspace({
  branchManager,
}: {
  branchManager: ReturnType<typeof useBranchManager>;
}) {
  const { agent, state, appendMessage } = useCloudPlotAgent();
  const {
    branches,
    currentBranch,
    currentBranchId,
    createBranch,
    switchBranch,
    saveBranchState,
    getBranchState,
  } = branchManager;

  // Register CopilotKit tools
  useFrontendTools();
  useInfraApproval();

  const restoredThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredThreadRef.current === currentBranch.threadId) return;
    restoredThreadRef.current = currentBranch.threadId;

    const branchState = getBranchState(currentBranchId);
    if (branchState) agent.setState(structuredClone(branchState.state));
  }, [currentBranch.threadId, currentBranchId, getBranchState, agent]);

  // Debounced browser-local backup of the visible workspace.
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
    [currentBranchId, state, saveBranchState, createBranch],
  );

  // Branch switching handler - saves current state before switching
  const handleSwitchBranch = useCallback(
    (branchId: string) => {
      if (branchId === currentBranchId) return;

      // Save current branch state before switching
      saveBranchState(currentBranchId, state, []);

      const branchState = switchBranch(branchId);
      if (branchState) {
        agent.setState(structuredClone(branchState.state));
      }
    },
    [agent, currentBranchId, state, saveBranchState, switchBranch],
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
