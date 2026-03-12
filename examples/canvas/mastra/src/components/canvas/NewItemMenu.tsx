"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CardType } from "@/lib/canvas/types";

export function NewItemMenu({ onSelect, align = "end", className }: { onSelect: (t: CardType) => void; align?: "start" | "end" | "center", className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="default" className={cn("gap-2 text-base font-semibold bg-card rounded-lg",
          className)}>
          <Plus className="size-5" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-0 w-fit bg-background">
        <DropdownMenuItem onClick={() => onSelect("project")}>Project</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("entity")}>Entity</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("note")}>Note</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("chart")}>Chart</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NewItemMenu;


