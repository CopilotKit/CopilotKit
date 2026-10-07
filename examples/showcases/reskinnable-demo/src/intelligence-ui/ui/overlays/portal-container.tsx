import { createContext, useContext } from 'react';

/** Keeps nested Radix overlays inside the active modal focus scope. */
export const OverlayPortalContainer = createContext<HTMLElement | null>(null);

/** Returns the nearest modal content node for a nested menu or popover. */
export function useOverlayPortalContainer(): HTMLElement | null {
  return useContext(OverlayPortalContainer);
}
