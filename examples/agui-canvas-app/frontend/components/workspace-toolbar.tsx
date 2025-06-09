"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Bot, Users, Save, Download, Share, MoreHorizontal, Zap, Eye, Edit3 } from "lucide-react"
import type { AgentType } from "@/lib/types"

interface WorkspaceToolbarProps {
  selectedAgent: AgentType
  isAgentActive: boolean
  setIsAgentActive: (active: boolean) => void
}

export function WorkspaceToolbar({ selectedAgent, isAgentActive, setIsAgentActive }: WorkspaceToolbarProps) {
  const [collaborators] = useState(2) // Mock collaborator count

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-8">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Shared Workspace</h1>
            <Badge variant="outline" className="gap-1">
              <Bot className="h-3 w-3" />
              {selectedAgent}
            </Badge>
          </div>

          <Separator orientation="vertical" className="h-6" />

          <div className="flex items-center gap-2">
            <Button
              variant={isAgentActive ? "default" : "outline"}
              size="sm"
              onClick={() => setIsAgentActive(!isAgentActive)}
              className="gap-2"
            >
              <Zap className="h-4 w-4" />
              {isAgentActive ? "Agent Active" : "Agent Standby"}
            </Button>

            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" />
              {collaborators} online
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm">
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm">
            <Save className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm">
            <Share className="h-4 w-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Download className="mr-2 h-4 w-4" />
                Export
              </DropdownMenuItem>
              <DropdownMenuItem>Version History</DropdownMenuItem>
              <DropdownMenuItem>Workspace Settings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
