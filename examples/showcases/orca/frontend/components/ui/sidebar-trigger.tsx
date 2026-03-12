"use client"

import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"

export function SidebarTrigger({ className }: { className?: string }) {
  return (
    <Button variant="ghost" size="icon" className={className}>
      <Menu className="h-5 w-5" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}
