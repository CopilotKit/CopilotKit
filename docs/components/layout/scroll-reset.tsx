"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Resets scroll position of the parent scroll container when navigating to a new page.
 * Fixes issue where scroll position persists when using collapsed TOC navigation.
 */
export function ScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    // Find the scroll container (docs-content-wrapper)
    const scrollContainer = document.querySelector(".docs-content-wrapper");
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }, [pathname]); // Run whenever pathname changes

  return null; // This component doesn't render anything
}
