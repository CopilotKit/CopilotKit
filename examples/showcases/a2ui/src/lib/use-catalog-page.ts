import { useEffect, useState } from "react";

/**
 * Whether the stage shows the catalog in place of the chat. The address bar
 * keeps it as `?catalog`, so the catalog can be linked to in a demo.
 */
export function useCatalogPage() {
  const [open, setOpen] = useState(false);

  // On the first load, open the catalog if the address asks for it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("catalog")) {
      setOpen(true);
    }
  }, []);

  // Afterwards, the address follows the stage.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("catalog", "");
    else url.searchParams.delete("catalog");
    if (url.href !== window.location.href) {
      window.history.replaceState(null, "", url);
    }
  }, [open]);

  return [open, setOpen] as const;
}
