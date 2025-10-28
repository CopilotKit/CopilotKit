"use client"

import Image from "next/image"
import { useSearchContext } from "fumadocs-ui/provider"

const SearchDialogButton = () => {
  const { setOpenSearch } = useSearchContext()

  return (
    <button
      onClick={() => setOpenSearch(true)}
      className="flex gap-2 items-center px-3 h-11 rounded-lg border cursor-pointer bg-glass-background dark:border-border border-[#01050726]"
    >
      <Image
        src="/images/navbar/loupe-light.svg"
        alt="Search icon"
        width={20}
        height={20}
        className="inline-block dark:hidden"
      />
      <Image
        src="/images/navbar/loupe-dark.svg"
        alt="Search icon"
        width={20}
        height={20}
        className="hidden dark:inline-block"
      />

      <span className="text-sm font-medium text-foreground/50 dark:text-white/50">
        Search...
      </span>

      <Image
        src="/images/navbar/search-shortcut-light.svg"
        alt="Search input shortcut icon"
        width={24}
        height={14}
        className="hidden xl:inline-block dark:hidden"
      />
      <Image
        src="/images/navbar/search-shortcut-dark.svg"
        alt="Search input shortcut icon"
        width={24}
        height={14}
        className="hidden xl:dark:inline-block"
      />
    </button>
  )
}

export default SearchDialogButton
