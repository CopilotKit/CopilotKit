"use client";

import { Banner } from "fumadocs-ui/components/banner";
import Link from "next/link";
import { PaintbrushIcon } from "lucide-react";
import { PiGraph } from "react-icons/pi";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { Sparkles, Rocket } from "lucide-react";
import { useState, useEffect } from "react";

// Time in milliseconds before a dismissed banner reappears
const BANNER_REAPPEAR_DELAY = 3 * 24 * 60 * 60 * 1000; // 3 days
const BANNER_DISMISSED_KEY = "nd-banner-rotating-banner";
const BANNER_DISMISSED_TIME_KEY = "nd-banner-rotating-banner-dismissed-at";

export function Banners() {
  const [currentBanner, setCurrentBanner] = useState(0);
  const [key, setKey] = useState(0); // Force re-render to show banner again

  const bannerContent = [
    {
      icon: <Rocket className="w-5 h-5 hidden md:block flex-shrink-0" />,
      mobileText: "CopilotKit fully supports MCP Apps!",
      desktopText: "Bring MCP Apps interaction to your users with CopilotKit!",
      buttonText: "See What's New",
      href: "/whats-new/mcp-apps-support",
    },
    {
      icon: <Sparkles className="w-5 h-5 hidden md:block flex-shrink-0" />,
      mobileText: "CopilotKit 1.50 is available!",
      desktopText:
        "CopilotKit 1.50 is available, featuring threads, no GraphQL, new interfaces, and more!",
      buttonText: "See What's New",
      href: "/whats-new/v1-50",
    },
  ];

  // Rotate banners
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBanner((prev) => (prev + 1) % bannerContent.length);
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  // Check for dismissed banner and handle reappearance based on timestamp
  useEffect(() => {
    const checkBannerExpiry = () => {
      const isDismissed = localStorage.getItem(BANNER_DISMISSED_KEY) === "true";

      if (isDismissed) {
        const dismissedAt = localStorage.getItem(BANNER_DISMISSED_TIME_KEY);

        if (dismissedAt) {
          const elapsed = Date.now() - parseInt(dismissedAt, 10);

          if (elapsed >= BANNER_REAPPEAR_DELAY) {
            // Time has passed - show banner again
            localStorage.removeItem(BANNER_DISMISSED_KEY);
            localStorage.removeItem(BANNER_DISMISSED_TIME_KEY);
            setKey((prev) => prev + 1);
          } else {
            // Schedule check for when delay expires
            const remaining = BANNER_REAPPEAR_DELAY - elapsed;
            const timeout = setTimeout(() => {
              localStorage.removeItem(BANNER_DISMISSED_KEY);
              localStorage.removeItem(BANNER_DISMISSED_TIME_KEY);
              setKey((prev) => prev + 1);
            }, remaining);
            return () => clearTimeout(timeout);
          }
        } else {
          // Banner was just dismissed - record the time
          localStorage.setItem(
            BANNER_DISMISSED_TIME_KEY,
            Date.now().toString(),
          );
        }
      }
    };

    checkBannerExpiry();

    // Also listen for storage changes (in case dismissed in this or another tab)
    const handleStorage = () => {
      const isDismissed = localStorage.getItem(BANNER_DISMISSED_KEY) === "true";
      const hasTimestamp = localStorage.getItem(BANNER_DISMISSED_TIME_KEY);

      if (isDismissed && !hasTimestamp) {
        localStorage.setItem(BANNER_DISMISSED_TIME_KEY, Date.now().toString());
      }
    };

    window.addEventListener("storage", handleStorage);

    // Also check periodically in case the banner was dismissed while on this page
    const interval = setInterval(checkBannerExpiry, 1000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, [key]);

  const content = bannerContent[currentBanner];

  return (
    <div key={key} className="w-full px-1 mt-1 xl:px-2 xl:mt-2">
      <Banner
        className="w-full text-foreground bg-secondary/80 backdrop-blur-sm border border-border rounded-2xl py-1.5 md:py-2"
        id="rotating-banner"
      >
        <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4">
          <div
            key={currentBanner}
            className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0"
          >
            {content.icon}
            <p
              className="text-xs md:text-base font-normal md:hidden font-sans"
              style={{ fontWeight: 400 }}
            >
              {content.mobileText}
            </p>
            <p
              className="text-sm sm:text-base font-normal hidden md:block font-sans"
              style={{ fontWeight: 400 }}
            >
              {content.desktopText}
            </p>
          </div>
          <Link
            href={content.href}
            className="text-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900 text-xs md:text-sm items-center bg-gradient-to-r from-indigo-200/50 to-purple-200/80 dark:from-indigo-900/40 dark:to-purple-900/50 flex px-2 py-0.5 md:px-4 md:py-1 no-underline whitespace-nowrap transition-all duration-100 hover:ring-2 hover:ring-indigo-400 hover:dark:text-indigo-200 rounded-lg flex-shrink-0"
          >
            {content.buttonText}
          </Link>
        </div>
      </Banner>
    </div>
  );
}

export function NewLookAndFeelBanner() {
  return (
    <Banner
      className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900 h-2!"
      variant="rainbow"
      id="new-look-and-feel-banner"
    >
      <PaintbrushIcon className="w-5 h-5" />
      <p>
        We are launching a new default look and feel! Checkout the{" "}
        <span className="underline">
          <Link href="/troubleshooting/migrate-to-1.8.2">
            {" "}
            migration guide{" "}
          </Link>
        </span>{" "}
        to learn more.
      </p>
    </Banner>
  );
}

export function CoagentsCrewAnnouncementBanner() {
  return (
    <Banner
      className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900"
      variant="rainbow"
      id="coagents-crew-announcement-banner"
    >
      <SiCrewai className="w-5 h-5 inline mb-1" /> CrewAI support is here!
      Checkout the{" "}
      <Link href="/crewai-crews" className="underline">
        Crew
      </Link>{" "}
      and{" "}
      <Link href="/crewai-flows" className="underline">
        Flow
      </Link>{" "}
      documentation.
    </Banner>
  );
}

export function ModelContextProtocolBanner() {
  return (
    <Banner
      className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important"
      variant="rainbow"
      id="model-context-protocol-banner"
    >
      <p className="w-3/4">
        <PiGraph className="w-5 h-5 inline mr-2" /> Model Context Protocol (MCP)
        support is here! Try it out{" "}
        <Link
          href="/direct-to-llm/guides/model-context-protocol"
          className="underline"
        >
          here
        </Link>
        . Register to our
        <Link
          href="https://go.copilotkit.ai/webinarMastra"
          target="_blank"
          className="underline ml-1"
        >
          webinar
        </Link>{" "}
        for a walkthrough.
      </p>
    </Banner>
  );
}

export function AGUIBanner() {
  return (
    <Banner
      className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important"
      variant="rainbow"
      id="agui-banner"
    >
      <p className="w-3/4">
        CopilotKit and our framework partners have launched the AG-UI protocol
        for agent-user interaction!{" "}
        <Link
          href="/ag-ui-protocol"
          target="_blank"
          className="underline"
          rel="noopener noreferrer"
        >
          Learn more
        </Link>
        .
      </p>
    </Banner>
  );
}

export function V150Banner() {
  return (
    <div className="w-full px-1 mt-1 xl:px-2 xl:mt-2">
      <Banner
        className="w-full text-foreground bg-secondary/80 backdrop-blur-sm border border-border rounded-2xl py-1.5 md:py-2"
        id="v150-banner"
      >
        <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4">
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0">
            <Sparkles className="w-5 h-5 hidden md:block flex-shrink-0" />
            {/* Short text for mobile (below 768px) */}
            <p
              className="text-xs md:text-base font-normal md:hidden font-sans"
              style={{ fontWeight: 400 }}
            >
              CopilotKit 1.50 is available!
            </p>
            {/* Full text for desktop (768px and above) */}
            <p
              className="text-sm sm:text-base font-normal hidden md:block font-sans"
              style={{ fontWeight: 400 }}
            >
              CopilotKit 1.50 is available, featuring threads, no GraphQL, new
              interfaces, and more!
            </p>
          </div>
          <Link
            href="/whats-new/v1-50"
            className="text-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900 text-xs md:text-sm items-center bg-gradient-to-r from-indigo-200/50 to-purple-200/80 dark:from-indigo-900/40 dark:to-purple-900/50 flex px-2 py-0.5 md:px-4 md:py-1 no-underline whitespace-nowrap transition-all duration-100 hover:ring-2 hover:ring-indigo-400 hover:dark:text-indigo-200 rounded-lg flex-shrink-0"
          >
            See What&apos;s New
          </Link>
        </div>
      </Banner>
    </div>
  );
}

export function MCPAppsLaunchBanner() {
  return (
    <div className="w-full px-1 mt-1 xl:px-2 xl:mt-2">
      <Banner
        className="w-full text-foreground bg-secondary/80 backdrop-blur-sm border border-border rounded-2xl py-1.5 md:py-2"
        id="mcp-apps-launch-banner"
      >
        <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4">
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0">
            <Rocket className="w-5 h-5 hidden md:block flex-shrink-0" />
            {/* Short text for mobile (below 768px) */}
            <p
              className="text-xs md:text-base font-normal md:hidden font-sans"
              style={{ fontWeight: 400 }}
            >
              Use MCP Apps with CopilotKit and AG-UI
            </p>
            {/* Full text for desktop (768px and above) */}
            <p
              className="text-sm sm:text-base font-normal hidden md:block font-sans"
              style={{ fontWeight: 400 }}
            >
              Use MCP Apps with CopilotKit and AG-UI
            </p>
          </div>
          <Link
            href="/whats-new/mcp-apps-support"
            className="text-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900 text-xs md:text-sm items-center bg-gradient-to-r from-indigo-200/50 to-purple-200/80 dark:from-indigo-900/40 dark:to-purple-900/50 flex px-2 py-0.5 md:px-4 md:py-1 no-underline whitespace-nowrap transition-all duration-100 hover:ring-2 hover:ring-indigo-400 hover:dark:text-indigo-200 rounded-lg flex-shrink-0"
          >
            See What's New
          </Link>
        </div>
      </Banner>
    </div>
  );
}
