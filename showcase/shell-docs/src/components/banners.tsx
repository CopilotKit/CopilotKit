"use client";

import Link from "next/link";
import { Rocket, X } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

// Time in milliseconds before a dismissed banner reappears
const BANNER_REAPPEAR_DELAY = 3 * 24 * 60 * 60 * 1000; // 3 days
const BANNER_DISMISSED_KEY = "nd-banner-rotating-banner";
const BANNER_DISMISSED_TIME_KEY = "nd-banner-rotating-banner-dismissed-at";

type BannerEntry = {
  icon: React.ReactNode;
  mobileText: string;
  desktopText: string;
  buttonText: string;
  href: string;
};

const bannerContent: BannerEntry[] = [
  {
    icon: <Rocket className="w-5 h-5 hidden md:block flex-shrink-0" />,
    mobileText: "CopilotKit fully supports MCP Apps!",
    desktopText: "Bring MCP Apps interaction to your users with CopilotKit!",
    buttonText: "See What's New",
    href: "/generative-ui/mcp-apps",
  },
];

export function Banners() {
  const [currentBanner, setCurrentBanner] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Hydration guard — server renders nothing so the banner can't flash
  // before localStorage state has been read.
  const [hydrated, setHydrated] = useState(false);

  // Rotate banners every 8 seconds (matches canonical implementation).
  useEffect(() => {
    if (bannerContent.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentBanner((prev) => (prev + 1) % bannerContent.length);
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  // Read + maintain dismissal state from localStorage. Banner reappears
  // after BANNER_REAPPEAR_DELAY has elapsed since dismissal.
  useEffect(() => {
    setHydrated(true);

    const checkBannerExpiry = () => {
      const isDismissed = localStorage.getItem(BANNER_DISMISSED_KEY) === "true";

      if (!isDismissed) {
        setDismissed(false);
        return;
      }

      const dismissedAt = localStorage.getItem(BANNER_DISMISSED_TIME_KEY);
      if (!dismissedAt) {
        // Backfill timestamp if dismissal flag exists without a timestamp
        // (e.g., set in another tab or by a legacy build).
        localStorage.setItem(BANNER_DISMISSED_TIME_KEY, Date.now().toString());
        setDismissed(true);
        return;
      }

      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed >= BANNER_REAPPEAR_DELAY) {
        localStorage.removeItem(BANNER_DISMISSED_KEY);
        localStorage.removeItem(BANNER_DISMISSED_TIME_KEY);
        setDismissed(false);
      } else {
        setDismissed(true);
      }
    };

    checkBannerExpiry();

    const handleStorage = () => checkBannerExpiry();
    window.addEventListener("storage", handleStorage);

    // Periodic re-check so the banner reappears mid-session once the TTL
    // expires without requiring a reload.
    const interval = setInterval(checkBannerExpiry, 1000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  // Reflect the banner's visible height into `--fd-banner-height` so
  // Fumadocs's fixed-positioned sidebar shifts down when the banner is
  // showing and snaps flush under BrandNav when it's dismissed. ~54px
  // is the rendered banner height across breakpoints; we set the
  // variable on <html> so all of Fumadocs's `top:` math picks it up.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--fd-banner-height",
      !hydrated || dismissed ? "0px" : "54px",
    );
  }, [hydrated, dismissed]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(BANNER_DISMISSED_KEY, "true");
    localStorage.setItem(BANNER_DISMISSED_TIME_KEY, Date.now().toString());
    setDismissed(true);
  }, []);

  if (!hydrated || dismissed) return null;

  const content = bannerContent[currentBanner];

  return (
    <div className="w-full px-1 mt-1 xl:px-2 xl:mt-2">
      <div
        id="rotating-banner"
        className="relative w-full rounded-2xl py-1.5 md:py-2"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border, rgba(0,0,0,0.08))",
        }}
      >
        <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4 pr-8 md:pr-10">
          <div
            key={currentBanner}
            className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0"
          >
            {content.icon}
            <p
              className="text-xs md:text-base font-normal md:hidden"
              style={{ fontWeight: 400 }}
            >
              {content.mobileText}
            </p>
            <p
              className="text-sm sm:text-base font-normal hidden md:block"
              style={{ fontWeight: 400 }}
            >
              {content.desktopText}
            </p>
          </div>
          <Link
            href={content.href}
            className="text-xs md:text-sm items-center flex px-2 py-0.5 md:px-4 md:py-1 no-underline whitespace-nowrap rounded-lg flex-shrink-0 transition-all duration-100"
            style={{
              background: "var(--accent-light, rgba(109, 69, 249, 0.12))",
              color: "var(--accent)",
              boxShadow: "0 0 0 1px var(--accent-light, rgba(109,69,249,0.2))",
            }}
          >
            {content.buttonText}
          </Link>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-secondary)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
