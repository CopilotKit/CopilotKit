"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  RocketIcon,
  CloudIcon, 
  TerminalIcon,
  SearchIcon 
} from "lucide-react";

export function TopNav() {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/",
      label: "Overview",
      icon: RocketIcon,
      isActive: pathname === "/"
    },
    {
      href: "https://cloud.copilotkit.ai",
      label: "Copilot Cloud",
      icon: CloudIcon,
      isExternal: true
    },
    {
      href: "/reference",
      label: "API Reference",
      icon: TerminalIcon,
      isActive: pathname.startsWith("/reference")
    }
  ];

  return (
    <div 
      className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 z-30 flex items-center justify-between px-6 py-3 mb-6"
      style={{ 
        height: '60px'
      }}
    >
          {/* Navigation Items - aligned with content */}
          <div className="flex items-center space-x-8">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  target={item.isExternal ? "_blank" : undefined}
                  rel={item.isExternal ? "noopener noreferrer" : undefined}
                  className={cn(
                    "flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    item.isActive
                      ? "text-purple-600 border-b-2 border-purple-600"
                      : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

      {/* Search */}
      <div className="flex items-center">
        <SearchField />
      </div>
    </div>
  );
}

function SearchField() {
  const toggleSearch = () => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
      })
    );
  };
  
  return (
    <div 
      onClick={toggleSearch} 
      className="cursor-pointer h-10 px-4 w-[240px] xl:w-[275px] inline-flex items-center gap-2 border bg-fd-secondary/50 p-1.5 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground rounded-md"
    >
      <SearchIcon className="w-4 h-4" />
      Search docs
      <div className="ms-auto inline-flex gap-0.5">
        <kbd className="rounded-md border bg-fd-background px-1.5 text-xs">⌘</kbd>
        <kbd className="rounded-md border bg-fd-background px-1.5 text-xs">K</kbd>
      </div>
    </div>
  );
}