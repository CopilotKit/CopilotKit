"use client"

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
  type SharedProps,
} from "fumadocs-ui/components/dialog/search"

const SearchDialog = ( props: SharedProps ) => {
  const { search, setSearch, query } = useDocsSearch({
    type: "fetch",
  })

  return (
      <SearchDialogComponent
        search={search}
        onSearchChange={setSearch}
        isLoading={query.isLoading}
        {...props}
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
  )
}

export default SearchDialog
