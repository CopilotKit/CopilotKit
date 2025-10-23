"use client"

import { useState } from "react"
import { useDocsSearch } from "fumadocs-core/search/client"
import {
  SearchDialog as SearchDialogComponent,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search"
import Image from "next/image"

const SearchDialog = () => {
  const [open, setOpen] = useState(false)
  const { search, setSearch, query } = useDocsSearch({
    type: "fetch",
  })

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex gap-2 items-center px-3 h-11 rounded-lg border cursor-pointer bg-white/5 border-white/5"
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

        <span className="text-sm font-medium text-white/50">Search...</span>

        <Image
          src="/images/navbar/search-shortcut-light.svg"
          alt="Search input shortcut icon"
          width={24}
          height={14}
          className="inline-block dark:hidden"
        />
        <Image
          src="/images/navbar/search-shortcut-dark.svg"
          alt="Search input shortcut icon"
          width={24}
          height={14}
          className="hidden dark:inline-block"
        />
      </button>

      <SearchDialogComponent
        open={open}
        onOpenChange={setOpen}
        search={search}
        onSearchChange={setSearch}
        isLoading={query.isLoading}
      >
        <SearchDialogOverlay />
        <SearchDialogContent>
          <SearchDialogHeader>
            <SearchDialogIcon />
            <SearchDialogInput />
            <SearchDialogClose />
          </SearchDialogHeader>
          <SearchDialogList
            items={query.data !== "empty" ? query.data : null}
          />
        </SearchDialogContent>
      </SearchDialogComponent>
    </>
  )
}

export default SearchDialog
