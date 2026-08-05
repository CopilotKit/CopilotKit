"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The mobile breakpoint — genuinely about small screens, not about whether the
 * panel constraints can be satisfied.
 *
 * It briefly had to be derived from the panel floors, because those floors needed
 * far more room than this and the layout would otherwise render constraints it
 * could not meet. Capping the assistant at a SHARE of the frame rather than a
 * pixel count removed that problem: two panels at 250px and 50% fit any viewport
 * this query admits, so the breakpoint can go back to being about phones.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

/**
 * Whether to use the side-by-side layout.
 *
 * Read through `useSyncExternalStore` rather than `useState` + a mount effect:
 * this repo treats `react-hooks/set-state-in-effect` as an error, and a media
 * query is the textbook external store.
 *
 * The server snapshot is `true` — this is a desktop-first showcase, so assuming
 * desktop avoids a visible overlay→panels flash on the machine it is demoed on.
 * A narrower viewport corrects on the client's first snapshot.
 */
export function useIsDesktop(): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
    query.addEventListener("change", onStoreChange);
    return () => query.removeEventListener("change", onStoreChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    () => true,
  );
}
