"use client"

import { useEffect, useState } from "react"
import { Workspace } from "@/components/workspace"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { AgentType } from "@/lib/types"
import { useCoAgent } from "@copilotkit/react-core"

export function AppLayout() {
  const [selectedAgent, setSelectedAgent] = useState<AgentType>("Researcher")
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Hello! I'm your AI assistant. How can I help you today?" },
  ])
 
  const addMessage = (message: string) => {
    setMessages([...messages, { role: "user", content: message }])

    // Simulate AI response
    setTimeout(() => {
      const responses = {
        Researcher: "I've researched this topic extensively. Here are my findings...",
        Planner: "Based on your request, I've created a strategic plan with the following steps...",
        Coder:
          "Here's the code implementation I recommend:\n\n```js\nconst solution = () => {\n  // Implementation\n  return result;\n};\n```",
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: responses[selectedAgent],
        },
      ])
    }, 1000)
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-16 items-center justify-between px-8">
            <div className="flex items-center gap-4">
              <AppSidebar
                messages={messages}
                addMessage={addMessage}
                selectedAgent={selectedAgent}
                setSelectedAgent={setSelectedAgent}
              />
            </div>
            <div className="flex items-center gap-2">
              {/* ...right content... */}
            </div>
          </div>
        </div>
        <Workspace
          selectedAgent={selectedAgent}
          lastMessage={messages.filter((m) => m.role === "assistant").pop()?.content || ""}
        />
      </div>
    </SidebarProvider>
  )
}
