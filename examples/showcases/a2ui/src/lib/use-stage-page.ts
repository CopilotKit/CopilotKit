import { useEffect, useState } from "react";

/** What the stage shows: the chat, or a page in its place. */
export type StagePage = "chat" | "catalog" | "connections";

const PAGES: StagePage[] = ["catalog", "connections"];

/**
 * The page on the stage. The address bar keeps it (`?catalog`,
 * `?connections`), so a page can be linked to in a demo, and an app's sign-in
 * can come back to the page it left from.
 */
export function useStagePage() {
  const [page, setPage] = useState<StagePage>("chat");

  // On the first load, open the page the address asks for.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = PAGES.find((name) => params.has(name));
    if (asked) setPage(asked);
  }, []);

  // Afterwards, the address follows the stage.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const name of PAGES) {
      if (name === page) url.searchParams.set(name, "");
      else url.searchParams.delete(name);
    }
    if (url.href !== window.location.href) {
      window.history.replaceState(null, "", url);
    }
  }, [page]);

  return [page, setPage] as const;
}
