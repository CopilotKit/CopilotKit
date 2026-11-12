"use client";

import { usePathname } from "next/navigation";
import { useDocsSearch } from "fumadocs-core/search/client";
import { fetchClient } from "fumadocs-core/search/client/fetch";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import type { DefaultSearchDialogProps } from "fumadocs-ui/components/dialog/search-default";
import { scopeFromPath } from "@/lib/live-scope";

/**
 * Fumadocs' default search dialog, asking `/api/search` for results in the
 * reader's scope: the frontend and framework prefix of the page they search
 * from (`/vue/mastra`), as shell-docs' search kept them. The prefix is part
 * of the request URL, so the client's per-URL result cache keeps one set per
 * scope.
 */
export default function DocsSearchDialog({
  api = "/api/search",
  delayMs,
  ...props
}: DefaultSearchDialogProps) {
  const pathname = usePathname() ?? "/";
  const { prefix } = scopeFromPath(pathname.split("/").filter(Boolean));
  const client = fetchClient({
    api: prefix ? `${api}?scope=${encodeURIComponent(prefix)}` : api,
  });
  const search = useDocsSearch({ client, delayMs });

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  );
}
