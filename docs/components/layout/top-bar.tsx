"use client";
import { SearchIcon } from "lucide-react";

export function TopBar() {
  return (
    <>
      <div className="p-2 h-[60px] hidden lg:block justify-center absolute w-[calc(100vw-var(--fd-sidebar-width)-20px)] ml-[var(--fd-sidebar-width)]">
        <div className="flex justify-center">
          <SearchToggle />
        </div>
      </div>
    </>
  );
}

export function SearchToggle() {
  return (
    <div onClick={toggleSearch} className="cursor-pointer h-10 absolute w-[400px] inline-flex items-center gap-2 border bg-fd-secondary/50 p-1.5 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground rounded-lg max-md:hidden">
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
