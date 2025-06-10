"use client"
import { AgentProvider } from "@/lib/agent-provider"
import { CopilotKitWrapper } from "./copilotkit-wrapper"
export default function Home() {
  return (
    <AgentProvider>
      <CopilotKitWrapper />
    </AgentProvider>
  )
}
