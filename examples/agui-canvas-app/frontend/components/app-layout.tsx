"use client"

import { useState } from "react"
import { Workspace } from "@/components/workspace"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { AgentType } from "@/lib/types"

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
        <AppSidebar
          messages={messages}
          addMessage={addMessage}
          selectedAgent={selectedAgent}
          setSelectedAgent={setSelectedAgent}
        />
        <Workspace
          selectedAgent={selectedAgent}
          lastMessage={messages.filter((m) => m.role === "assistant").pop()?.content || ""}
        />
      </div>
    </SidebarProvider>
  )
}
