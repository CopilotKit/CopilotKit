"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, X } from "lucide-react";

type BannerEntry = {
  mobileText: string;
  title: string;
  source: string;
  buttonText: string;
  href: string;
};

const bannerContent: BannerEntry[] = [
  {
    mobileText: "Free Generative UI course",
    title: "Build Interactive Agents with Generative UI",
    source: "DeepLearning.AI",
    buttonText: "Start free course",
    href: "https://www.deeplearning.ai/short-courses/build-interactive-agents-with-generative-ui/",
  },
];

const BANNER_REAPPEAR_DELAY = 3 * 24 * 60 * 60 * 1000;
const BANNER_DISMISSED_KEY = "nd-banner-rotating-banner";
const BANNER_DISMISSED_TIME_KEY = "nd-banner-rotating-banner-dismissed-at";
const LEGACY_DISMISSED_STORAGE_KEY = "shell-docs-course-banner-dismissed";

function setBannerHeight(height: "0px" | "40px") {
  document.documentElement.style.setProperty("--fd-banner-height", height);
}

export function Banners() {
  const content = bannerContent[0];
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);

    const checkBannerExpiry = () => {
      const isDismissed =
        localStorage.getItem(BANNER_DISMISSED_KEY) === "true" ||
        localStorage.getItem(LEGACY_DISMISSED_STORAGE_KEY) === "true";

      if (!isDismissed) {
        setDismissed(false);
        return;
      }

      const dismissedAt = localStorage.getItem(BANNER_DISMISSED_TIME_KEY);
      if (!dismissedAt) {
        localStorage.setItem(BANNER_DISMISSED_TIME_KEY, Date.now().toString());
        setDismissed(true);
        return;
      }

      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed >= BANNER_REAPPEAR_DELAY) {
        localStorage.removeItem(BANNER_DISMISSED_KEY);
        localStorage.removeItem(BANNER_DISMISSED_TIME_KEY);
        localStorage.removeItem(LEGACY_DISMISSED_STORAGE_KEY);
        setDismissed(false);
      } else {
        setDismissed(true);
      }
    };

    checkBannerExpiry();

    const handleStorage = () => checkBannerExpiry();
    window.addEventListener("storage", handleStorage);
    const interval = setInterval(checkBannerExpiry, 1000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setBannerHeight(!hydrated || dismissed ? "0px" : "40px");
  }, [hydrated, dismissed]);

  const dismissBanner = useCallback(() => {
    localStorage.setItem(BANNER_DISMISSED_KEY, "true");
    localStorage.setItem(BANNER_DISMISSED_TIME_KEY, Date.now().toString());
    localStorage.setItem(LEGACY_DISMISSED_STORAGE_KEY, "true");
    setDismissed(true);
  }, []);

  if (!hydrated || dismissed) {
    return null;
  }

  return (
    <div
      id="shell-docs-course-banner"
      className="sticky top-0 z-40 flex h-10 flex-row items-center justify-center overflow-hidden border-b px-4 text-center text-sm font-medium text-white shadow-none shell-docs-course-banner"
    >
      <div className="relative z-1 flex w-full min-w-0 items-center justify-center gap-2 pr-8 md:gap-2.5">
        <span
          className="shell-docs-radius-icon hidden h-5 w-5 shrink-0 items-center justify-center border border-white/30 bg-white/16 text-white lg:inline-flex"
          aria-label="Free course"
        >
          <BookOpenCheck className="h-3 w-3" aria-hidden="true" />
        </span>
        <p className="min-w-0 truncate text-xs font-medium text-white md:text-[13px]">
          <span className="md:hidden">{content.mobileText}</span>
          <span className="hidden md:inline">{content.title}</span>
          <span className="hidden text-white/72 md:inline">
            {" "}
            with {content.source}
          </span>
        </p>
        <Link
          href={content.href}
          target={content.href.startsWith("http") ? "_blank" : undefined}
          rel={
            content.href.startsWith("http") ? "noopener noreferrer" : undefined
          }
          className="shell-docs-radius-control inline-flex h-6 shrink-0 items-center gap-1 bg-white px-2.5 text-[11px] font-semibold text-[var(--accent)] no-underline shadow-[var(--shadow-control)] transition-colors duration-150 hover:bg-white/90 md:px-3"
        >
          {content.buttonText}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <button
        type="button"
        aria-label="Close Banner"
        onClick={dismissBanner}
        className="absolute inset-e-2 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/85 transition-colors duration-100 hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
