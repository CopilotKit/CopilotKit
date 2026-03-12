"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";
import { SidebarWidgets } from "./sidebar-widgets";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle button */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-4 top-4 z-50 md:hidden cursor-pointer"
          onClick={() => setIsOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed z-40 flex h-full w-[220px] flex-col gap-4 border-2 border-white bg-white/50 p-3 transition-transform md:relative md:translate-x-0 rounded-lg",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarHeader />
        <hr />
        <SidebarNav onNavigate={() => setIsOpen(false)} />
        <hr />
        <SidebarWidgets onNavigate={() => setIsOpen(false)} />
      </aside>
    </>
  );
}
