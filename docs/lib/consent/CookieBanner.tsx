"use client";

import { useConsent } from "./ConsentContext";

const PRIVACY_URL = "https://www.copilotkit.ai/privacy-policy";

export function CookieBanner() {
  const { bannerVisible, isStrictRegion, acceptAll, rejectAll, openPreferences } =
    useConsent();
  if (!bannerVisible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-[480px] rounded-2xl border border-border bg-background p-5 shadow-2xl sm:right-auto sm:left-4 sm:mx-0"
    >
      <h2 className="text-base font-semibold text-foreground">We use cookies</h2>
      <p className="mt-2 text-sm text-foreground/80">
        {isStrictRegion
          ? "We use cookies and similar technologies for analytics and marketing. We won't load any non-essential cookies until you choose."
          : "We use cookies and similar technologies for analytics and marketing. You can accept all, reject all, or customize your choices."}{" "}
        Read our{" "}
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[#7076D5]"
        >
          Privacy Policy
        </a>
        .
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={acceptAll}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={rejectAll}
          className="rounded-md border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          Reject all
        </button>
        <button
          type="button"
          onClick={openPreferences}
          className="rounded-md px-4 py-2 text-sm font-semibold text-foreground underline transition hover:text-[#7076D5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          Customize
        </button>
      </div>
    </div>
  );
}
