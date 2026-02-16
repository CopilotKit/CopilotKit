"use client";
import { SearchIcon } from "lucide-react";
import { LinkToCopilotCloud } from "@/components/react/link-to-copilot-cloud";

export function TopBar() {
  return (
    <>
      <div className="absolute ml-[var(--fd-sidebar-width)] hidden h-[70px] w-[calc(100vw-var(--fd-sidebar-width)-20px)] p-2 lg:block">
        <div className="flex items-center justify-end gap-2">
          <LinkToCopilotCloud />
          <SearchToggle />
        </div>
      </div>
    </>
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
      }),
    );
  };

  return (
    <div
      onClick={toggleSearch}
      className="bg-fd-secondary/50 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex h-12 w-[240px] cursor-pointer items-center gap-2 rounded-md border p-1.5 px-4 text-sm transition-colors max-md:hidden xl:w-[275px]"
    >
      <SearchIcon className="text-foreground h-4 w-4" />
      Search docs
      <div className="ms-auto inline-flex gap-0.5">
        <kbd className="bg-fd-background rounded-md border px-1.5">⌘</kbd>
        <kbd className="bg-fd-background rounded-md border px-1.5">K</kbd>
      </div>
    </div>
  );
}
