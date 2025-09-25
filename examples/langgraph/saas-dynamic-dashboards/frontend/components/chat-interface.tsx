"use client"

import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useSharedContext } from "@/lib/shared-context";
import { instructions } from "@/lib/prompts";
export function ChatInterface() {
  const { prData } = useSharedContext()
  return (
    <div className="flex h-full w-80 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-4 py-4">
        <h2 className="font-semibold">EnterpriseX Assistant</h2>
      </div>
      <CopilotChat className="flex-1 min-h-0 py-4"
        instructions={instructions.replace("{prData}", JSON.stringify(prData))}
      />
    </div>
  )
}
