"use client"

import { Eye, Pencil } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function ViewEditToggle({
    disabled,
    mode,
    onToggle,
}: {
    disabled: boolean;
    mode: 'view' | 'edit',
    onToggle: (mode: 'view' | 'edit') => void
}) {
    const getButtonClass = (selected = false) => cn(
                "h-8 px-2 rounded-none bg-white",
                selected ? "bg-blue-50" : "hover:bg-gray-200",
                "active:bg-gray-300",
                disabled && "opacity-50 cursor-not-allowed bg-gray-100"
            )

  return (
      <div className="flex items-center justify-center border border-black/10 rounded-sm">
        <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle("view")}
            disabled={disabled}
            className={getButtonClass(mode === "view")}
            aria-pressed={mode === "view"}
        >
          <Eye className="h-4 w-4 mr-1"/>
          <span className="sr-only">Switch to view mode</span>
          View
        </Button>
        <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle("edit")}
            disabled={disabled}
            className={getButtonClass(mode === "edit")}
            aria-pressed={mode === "edit"}
        >
          <Pencil className="h-4 w-4 mr-1"/>
          <span className="sr-only">Switch to edit mode</span>
          Edit
        </Button>
      </div>
  )
}

