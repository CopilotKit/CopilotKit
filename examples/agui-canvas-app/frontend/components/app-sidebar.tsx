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
import { CopilotChat } from "@copilotkit/react-ui"
import "@copilotkit/react-ui/styles.css";
interface AppSidebarProps {
  messages: { role: "user" | "assistant"; content: string }[]
  addMessage: (message: string) => void
  selectedAgent: AgentType
  setSelectedAgent: (agent: AgentType) => void
}

export function AppSidebar({ messages, addMessage, selectedAgent, setSelectedAgent }: AppSidebarProps) {


  return (
    <Sidebar className="w-[380px] border-r">
      <SidebarHeader className="border-b p-4">
        <h2 className="text-2xl font-semibold">AI Canvas</h2>
      </SidebarHeader>


      <CopilotChat
        Input={({ onSend, onStop, onUpload, inProgress, isVisible }) => {
          const [input, setInput] = useState("")

          const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault()
            if (input.trim()) {
              // addMessage(input)
              setInput("")
              onSend(input)
            }
          }
          return (
            <SidebarFooter className="border-t p-6">
              <div className="space-y-5">
                <AgentSelector />

                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    className="min-h-[100px] resize-none rounded-xl border-muted-foreground/20 p-3"
                  />
                  <Button disabled={inProgress} type="submit" className="self-end rounded-xl px-5">
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </Button>
                </form>
              </div>
            </SidebarFooter>
          )
        }}
        className="h-full"
      />

      {/* <SidebarRail /> */}
    </Sidebar>
  )
}
