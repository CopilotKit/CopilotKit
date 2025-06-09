"use client"

import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useState } from "react"
import type { AgentType } from "@/lib/types"

const agents = [
  { value: "Researcher", label: "Researcher" },
  { value: "Planner", label: "Planner" },
  { value: "Coder", label: "Coder" },
] as const

interface AgentSelectorProps {
  selectedAgent: AgentType
  setSelectedAgent: (agent: AgentType) => void
}

export function AgentSelector({ selectedAgent, setSelectedAgent }: AgentSelectorProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">Select Agent</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between rounded-xl border-muted-foreground/20 py-6"
          >
            {selectedAgent}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0">
          <Command>
            <CommandInput placeholder="Search agent..." />
            <CommandList>
              <CommandEmpty>No agent found.</CommandEmpty>
              <CommandGroup>
                {agents.map((agent) => (
                  <CommandItem
                    key={agent.value}
                    value={agent.value}
                    onSelect={() => {
                      setSelectedAgent(agent.value as AgentType)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", selectedAgent === agent.value ? "opacity-100" : "opacity-0")}
                    />
                    {agent.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
