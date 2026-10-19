import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

/** Subscribe to live OS motion-preference changes. */
function subscribe(notify: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

/** Read the current preference; SSR assumes reduced motion until hydration. */
export function useMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? true,
    () => true,
  );
}
