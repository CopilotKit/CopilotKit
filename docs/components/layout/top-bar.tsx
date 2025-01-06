"use client";
import { SearchIcon } from "lucide-react";
import { FaEdit } from "react-icons/fa";
import { Socials } from "@/components/react/socials";
import { LinkToCopilotCloud } from "@/components/react/link-to-copilot-cloud";
import { Button } from "@/components/ui/button";

export function TopBar() {
  return (
    <>
      <div className="p-2 h-[60px] hidden lg:block absolute w-[calc(100vw-var(--fd-sidebar-width)-20px)] ml-[var(--fd-sidebar-width)]">
        <div className="flex justify-between items-center gap-2">
          <Socials />
          <div className="flex justify-end items-center gap-2">
            <LinkToCopilotCloud />
            <div className="h-8 border-l border-secondary-foreground/20 border-1.5" />
            <SearchToggle />
          </div>
        </div>
      </div>
    </>
  );
}

export function SearchToggle() {
  return (
    <div onClick={toggleSearch} className="cursor-pointer h-10 w-[240px] inline-flex items-center gap-2 border bg-fd-secondary/50 p-1.5 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground rounded-md max-md:hidden">
      <SearchIcon className="w-4 h-4" />
      Search
      <div className="ms-auto inline-flex gap-0.5">
        <kbd className="rounded-md border bg-fd-background px-1.5">⌘</kbd>
        <kbd className="rounded-md border bg-fd-background px-1.5">K</kbd>
      </div>
    </div>
  );
}

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
