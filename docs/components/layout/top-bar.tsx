"use client";
import { SearchIcon } from "lucide-react";
import { TerminalIcon } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/app/logo";
import { MenuButton } from "./menu-button";
import { AgentFrameworkDropdown } from "./agent-framework-dropdown";

export function TopBar() {
  return (
    <div className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center">
          <Link href="/" className="flex items-center">
            <Logo />
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 ml-8 flex items-center gap-4">
          <AgentFrameworkDropdown />
          
          <Link href="/reference" className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent">
            <TerminalIcon className="w-4 h-4" />
            <span className="font-medium text-sm">API Reference</span>
          </Link>
        </div>

        {/* Search and Menu */}
        <div className="flex items-center gap-2">
          <SearchToggle />
          <MenuButton />
        </div>
      </div>
    </div>
  );
}

export function SearchToggle() {
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
    <div onClick={toggleSearch} className="cursor-pointer h-12 px-4 w-[240px] xl:w-[275px] inline-flex items-center gap-2 border bg-fd-secondary/50 p-1.5 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground rounded-md max-md:hidden">
      <SearchIcon className="w-4 h-4 text-foreground" />
      Search docs
      <div className="ms-auto inline-flex gap-0.5">
        <kbd className="rounded-md border bg-fd-background px-1.5">⌘</kbd>
        <kbd className="rounded-md border bg-fd-background px-1.5">K</kbd>
      </div>
    </div>
  );
}
