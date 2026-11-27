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
import { UNSCOPED_SEGMENTS, scopeFromPath } from "@/lib/live-scope";
import { useSavedFrontend } from "@/proto/frontend";
import { useLastFramework } from "@/proto/last-framework";
import { stackPrefix } from "@/proto/stack-href";
import { withBasePath } from "@/lib/base-path";

/**
 * Fumadocs' default search dialog, asking `/api/search` for results in the
 * reader's scope: the frontend and framework prefix of the page they search
 * from (`/vue/mastra`), as shell-docs' search kept them. The prefix is part
 * of the request URL, so the client's per-URL result cache keeps one set per
 * scope. From a page that isn't per stack (the home, the reference, the
 * cookbook), the scope is the reader's saved stack.
 */
export default function DocsSearchDialog({
  api = withBasePath("/api/search"),
  delayMs,
  ...props
}: DefaultSearchDialogProps) {
  const pathname = usePathname() ?? "/";
  const path = pathname.split("/").filter(Boolean);
  const savedFrontend = useSavedFrontend();
  const [savedFramework] = useLastFramework();
  const perStack =
    path.length > 0 && path[0] !== "ask" && !UNSCOPED_SEGMENTS.has(path[0]);
  const prefix = perStack
    ? scopeFromPath(path).prefix
    : savedFrontend
      ? stackPrefix(savedFrontend, savedFramework)
      : "";
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
