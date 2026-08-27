"use client";

import { useEffect, useState, useCallback } from "react";
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
  const { agent, state, isReady, appendMessage } = useCloudPlotAgent();
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

  const [restoration, setRestoration] = useState<{
    agent: typeof agent;
    threadId: string;
    expectedState: string | null;
    confirmed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isReady) return;
    if (
      restoration?.agent === agent &&
      restoration.threadId === currentBranch.threadId
    ) {
      return;
    }

    const branchState = getBranchState(currentBranchId);
    if (branchState) {
      const restoredState = structuredClone(branchState.state);
      agent.setState(restoredState);
      setRestoration({
        agent,
        threadId: currentBranch.threadId,
        expectedState: JSON.stringify(restoredState),
        confirmed: false,
      });
      return;
    }

    setRestoration({
      agent,
      threadId: currentBranch.threadId,
      expectedState: null,
      confirmed: true,
    });
  }, [
    currentBranch.threadId,
    currentBranchId,
    getBranchState,
    agent,
    isReady,
    restoration,
  ]);

  useEffect(() => {
    if (
      !restoration ||
      restoration.confirmed ||
      restoration.agent !== agent ||
      restoration.threadId !== currentBranch.threadId
    ) {
      return;
    }
    if (JSON.stringify(state) === restoration.expectedState) {
      setRestoration({ ...restoration, confirmed: true });
    }
  }, [agent, currentBranch.threadId, restoration, state]);

  // Debounced browser-local backup of the visible workspace.
  useEffect(() => {
    if (
      !isReady ||
      !restoration?.confirmed ||
      restoration.agent !== agent ||
      restoration.threadId !== currentBranch.threadId
    ) {
      return;
    }

    const timer = setTimeout(() => {
      saveBranchState(currentBranchId, state, []);
    }, 500);

    return () => clearTimeout(timer);
  }, [
    agent,
    currentBranch.threadId,
    currentBranchId,
    isReady,
    restoration,
    saveBranchState,
    state,
  ]);

  // Branch creation handler - forks current state
  const handleCreateBranch = useCallback(
    (name: string) => {
      if (!isReady) return;
      // Save current state to current branch first
      saveBranchState(currentBranchId, state, []);

      // Create new branch with forked state (deep clone)
      const forkState = {
        state: structuredClone(state),
        messages: [],
      };
      createBranch(name, forkState);
    },
    [currentBranchId, state, saveBranchState, createBranch, isReady],
  );

  // Branch switching handler - saves current state before switching
  const handleSwitchBranch = useCallback(
    (branchId: string) => {
      if (!isReady || branchId === currentBranchId) return;

      // Save current branch state before switching
      saveBranchState(currentBranchId, state, []);

      const branchState = switchBranch(branchId);
      if (branchState) {
        agent.setState(structuredClone(branchState.state));
      }
    },
    [agent, currentBranchId, state, saveBranchState, switchBranch, isReady],
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
