"use client"

import { useState } from "react"
import { WorkspaceToolbar } from "@/components/workspace-toolbar"
import { ResearcherWorkspace } from "@/components/workspaces/researcher-workspace"
import { PlannerWorkspace } from "@/components/workspaces/planner-workspace"
import { CoderWorkspace } from "@/components/workspaces/coder-workspace"
import type { AgentType } from "@/lib/types"

interface WorkspaceProps {
  selectedAgent: AgentType
  lastMessage: string
}

export function Workspace({ selectedAgent, lastMessage }: WorkspaceProps) {
  const [isAgentActive, setIsAgentActive] = useState(false)
  const [workspaceContent, setWorkspaceContent] = useState("")

  const renderWorkspace = () => {
    switch (selectedAgent) {
      case "Researcher":
        return (
          <ResearcherWorkspace
            content={workspaceContent}
            setContent={setWorkspaceContent}
            lastMessage={lastMessage}
            isAgentActive={isAgentActive}
          />
        )
      case "Planner":
        return (
          <PlannerWorkspace
            content={workspaceContent}
            setContent={setWorkspaceContent}
            lastMessage={lastMessage}
            isAgentActive={isAgentActive}
          />
        )
      case "Coder":
        return (
          <CoderWorkspace
            content={workspaceContent}
            setContent={setWorkspaceContent}
            lastMessage={lastMessage}
            isAgentActive={isAgentActive}
          />
        )
    }
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceToolbar
        selectedAgent={selectedAgent}
        isAgentActive={isAgentActive}
        setIsAgentActive={setIsAgentActive}
      />
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-6xl">{renderWorkspace()}</div>
      </div>
    </main>
  )
}
