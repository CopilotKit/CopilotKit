"use client";

import { Banner } from "fumadocs-ui/components/banner";
import Link from "next/link";
import { PaintbrushIcon } from "lucide-react";
import { PiGraph } from "react-icons/pi";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { Sparkles, Rocket } from "lucide-react";
import { useState, useEffect } from "react";

export function Banners() {
  const [currentBanner, setCurrentBanner] = useState(0);

  const bannerContent = [
    {
      icon: <Rocket className="w-5 h-5 hidden md:block flex-shrink-0" />,
      mobileText: "A2UI Launched: Full CopilotKit support at launch!",
      desktopText: "A2UI Launched: CopilotKit has partnered with Google to deliver full support in both CopilotKit and AG-UI!",
      buttonText: "Check it out",
      href: "/whats-new/a2ui-launch"
    },
    {
      icon: <Sparkles className="w-5 h-5 hidden md:block flex-shrink-0" />,
      mobileText: "CopilotKit 1.50 is available!",
      desktopText: "CopilotKit 1.50 is available, featuring threads, no GraphQL, new interfaces, and more!",
      buttonText: "See What's New",
      href: "/whats-new/v1-50"
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBanner((prev) => (prev + 1) % bannerContent.length);
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  const content = bannerContent[currentBanner];

  return (
    <Banner className="w-full text-white bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-800 dark:to-purple-800 py-2 md:py-3" variant="rainbow" id="rotating-banner">
      <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4">
        <div 
          key={currentBanner}
          className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0 text-white/80"
          style={{ animation: 'slideInFromLeft 0.5s ease-out' }}
        >
          {content.icon}
          <p className="text-xs md:text-base font-normal md:hidden">
            {content.mobileText}
          </p>
          <p className="text-sm sm:text-base font-normal hidden md:block">
            {content.desktopText}
          </p>
        </div>
        <Link 
          href={content.href}
          className="px-2 py-0.5 md:px-6 md:py-1 bg-white/50 text-white hover:bg-gray-100 rounded-lg text-xs md:text-base font-normal transition-colors whitespace-nowrap flex-shrink-0 shadow-md"
        >
          {content.buttonText}
        </Link>
      </div>
      <style jsx>{`
        @keyframes slideInFromLeft {
          0% {
            transform: translateX(-30px);
            opacity: 0;
          }
          100% {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </Banner>
  )
}

export function NewLookAndFeelBanner() {
  return (
    <Banner className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900 h-2!" variant="rainbow" id="new-look-and-feel-banner">
      <PaintbrushIcon className="w-5 h-5" />
      <p>
        We are launching a new default look and feel!
        Checkout the <span className="underline"><Link href="/troubleshooting/migrate-to-1.8.2"> migration guide </Link></span> to learn more.
      </p>
    </Banner>
  )
}

export function CoagentsCrewAnnouncementBanner() {
  return (
    <Banner className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900" variant="rainbow" id="coagents-crew-announcement-banner">
      <SiCrewai className="w-5 h-5 inline mb-1" /> CrewAI support is here! Checkout the <Link href="/crewai-crews" className="underline">Crew</Link> and <Link href="/crewai-flows" className="underline">Flow</Link> documentation.
    </Banner>
  )
}

export function ModelContextProtocolBanner() {
  return (
    <Banner className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important" variant="rainbow" id="model-context-protocol-banner">
      <p className="w-3/4">
        <PiGraph className="w-5 h-5 inline mr-2" /> Model Context Protocol (MCP) support is here! Try it out <Link href="/direct-to-llm/guides/model-context-protocol" className="underline">here</Link>. Register to our<Link href="https://go.copilotkit.ai/webinarMastra" target="_blank" className="underline ml-1">webinar</Link> for a walkthrough.
      </p>
    </Banner>
  )
}

export function AGUIBanner() {
  return (
    <Banner className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important" variant="rainbow" id="agui-banner">
      <p className="w-3/4">
        CopilotKit and our framework partners have launched the AG-UI protocol for agent-user interaction! <Link href="/ag-ui-protocol" target="_blank" className="underline" rel="noopener noreferrer">Learn more</Link>.
      </p>
    </Banner>
  )
}

export function V150Banner() {
  return (
    <Banner className="w-full text-white bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-800 dark:to-purple-800 py-2 md:py-3" variant="rainbow" id="v150-banner">
      <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4">
        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0 text-white/80">
          <Sparkles className="w-5 h-5 hidden md:block flex-shrink-0" />
          {/* Short text for mobile (below 768px) */}
          <p className="text-xs md:text-base font-normal md:hidden">
            CopilotKit 1.50 is available!
          </p>
          {/* Full text for desktop (768px and above) */}
          <p className="text-sm sm:text-base font-normal hidden md:block">
            CopilotKit 1.50 is available, featuring threads, no GraphQL, new interfaces, and more!
          </p>
        </div>
        <Link 
          href="/whats-new/v1-50"
          className="px-2 py-0.5 md:px-6 md:py-1 bg-white/50 text-white hover:bg-gray-100 rounded-lg text-xs md:text-base font-normal transition-colors whitespace-nowrap flex-shrink-0 shadow-md"
        >
          See What&apos;s New
        </Link>
      </div>
    </Banner>
  )
}

export function A2UILaunchBanner() {
  return (
    <Banner className="w-full text-white bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-800 dark:to-purple-800 py-2 md:py-3" variant="rainbow" id="a2ui-launch-banner">
      <div className="flex flex-row items-center justify-center gap-1.5 md:gap-3 w-full px-1 md:px-4">
        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink min-w-0 text-white/80">
          <Rocket className="w-5 h-5 hidden md:block flex-shrink-0" />
          {/* Short text for mobile (below 768px) */}
          <p className="text-xs md:text-base font-normal md:hidden">
            A2UI Launch: Full CopilotKit support at launch!
          </p>
          {/* Full text for desktop (768px and above) */}
          <p className="text-sm sm:text-base font-normal hidden md:block">
            A2UI Launch: CopilotKit has partnered with Google to deliver full support at launch in both CopilotKit and AG-UI!
          </p>
        </div>
        <Link 
          href="/whats-new/a2ui-launch"
          className="px-2 py-0.5 md:px-6 md:py-1 bg-white/50 text-white hover:bg-gray-100 rounded-lg text-xs md:text-base font-normal transition-colors whitespace-nowrap flex-shrink-0 shadow-md"
        >
          Check it out
        </Link>
      </div>
    </Banner>
  )
}