"use client";

import { useConsent } from "./ConsentContext";

export function CookiePreferencesButton() {
  const { hydrated, bannerVisible, openPreferences } = useConsent();
  // Hide while the banner is visible (banner has its own controls) or before hydration.
  if (!hydrated || bannerVisible) return null;

  return (
    <button
      type="button"
      onClick={openPreferences}
      aria-label="Open cookie preferences"
      className="fixed bottom-4 left-4 z-40 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm backdrop-blur transition hover:text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
    >
      Cookie preferences
    </button>
  );
}
