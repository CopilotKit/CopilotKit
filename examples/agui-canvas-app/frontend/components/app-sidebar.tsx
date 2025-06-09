"use client"

import type React from "react"

import { useState } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentSelector } from "@/components/agent-selector"
import type { AgentType } from "@/lib/types"
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar"

interface AppSidebarProps {
  messages: { role: "user" | "assistant"; content: string }[]
  addMessage: (message: string) => void
  selectedAgent: AgentType
  setSelectedAgent: (agent: AgentType) => void
}

export function AppSidebar({ messages, addMessage, selectedAgent, setSelectedAgent }: AppSidebarProps) {
  const [input, setInput] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) {
      addMessage(input)
      setInput("")
    }
  }

  return (
    <Sidebar className="w-[380px] border-r">
      <SidebarHeader className="border-b p-6">
        <h2 className="text-2xl font-semibold">AI Canvas</h2>
      </SidebarHeader>

      <SidebarContent>
        <ScrollArea className="h-[calc(100vh-16rem)]">
          <div className="flex flex-col gap-6 p-6">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-card-foreground border"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{message.content}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="border-t p-6">
        <div className="space-y-5">
          <AgentSelector selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} />

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="min-h-[100px] resize-none rounded-xl border-muted-foreground/20 p-3"
            />
            <Button type="submit" className="self-end rounded-xl px-5">
              <Send className="mr-2 h-4 w-4" />
              Send
            </Button>
          </form>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
