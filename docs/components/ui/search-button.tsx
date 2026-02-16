"use client";

import Image from "next/image";
import { useSearchContext } from "fumadocs-ui/contexts/search";
// Icons
import LoupeIcon from "@/components/ui/icons/loupe";
import SearchShortcutIcon from "@/components/ui/icons/search-shortcut";

const SearchDialogButton = () => {
  const { setOpenSearch } = useSearchContext();

  return (
    <button
      onClick={() => setOpenSearch(true)}
      className="lg:bg-glass-background dark:border-border -ml-2 flex h-11 cursor-pointer items-center gap-2 rounded-lg border-[#01050726] bg-transparent px-3 lg:ml-0 lg:border"
    >
      <LoupeIcon />

      <span className="text-foreground/50 hidden text-sm font-medium lg:block dark:text-white/50">
        Search...
      </span>

      <SearchShortcutIcon className="hidden xl:inline-block" />
    </button>
  );
};

export default SearchDialogButton;
