"use client"

import Image from "next/image"
import { useSearchContext } from "fumadocs-ui/provider"
// Icons
import LoupeIcon from "@/components/ui/icons/loupe"
import SearchShortcutIcon from "@/components/ui/icons/search-shortcut"

const SearchDialogButton = () => {
  const { setOpenSearch } = useSearchContext()

  return (
    <button
      onClick={() => setOpenSearch(true)}
      className="-ml-2 md:ml-0 flex gap-2 items-center px-3 h-11 rounded-lg md:border cursor-pointer bg-transparent md:bg-glass-background dark:border-border border-[#01050726]"
    >
      <LoupeIcon />

      <span className="hidden text-sm font-medium text-foreground/50 dark:text-white/50 md:block">
        Search...
      </span>

      <SearchShortcutIcon className="hidden xl:inline-block" />
    </button>
  )
}

export default SearchDialogButton
